import { getSupabaseAdmin } from "@/lib/supabase/server";
import { generic } from "./errors";
import {
  DAY_WINDOW_SECONDS,
  MESSAGES_PER_DAY,
  MESSAGES_PER_MINUTE,
  MINUTE_WINDOW_SECONDS,
} from "./limits";

/**
 * Freno de consumo del chat.
 *
 * Dos ventanas: una por minuto contra las ráfagas y una por día contra el gasto
 * de cuota. Cada mensaje son DOS llamadas al modelo, así que el límite de
 * mensajes vale la mitad en peticiones a Google de lo que parece.
 *
 * EN POSTGRESQL Y NO EN MEMORIA. Vercel es serverless: un contador en una
 * variable de módulo no se comparte entre instancias, no sobrevive a un arranque
 * en frío y se puede saltar simplemente abriendo dos pestañas. La tabla ya está
 * ahí y el patrón —contar en SQL con `insert ... on conflict`— es el mismo que
 * `lib/auth/lockout.ts` usa para el PIN.
 *
 * El contador es GLOBAL, no por IP: la aplicación tiene un usuario. Limitar por
 * IP permitiría rotar direcciones, y aquí no hay nada que proteger de un tercero
 * porque sin sesión no se llega hasta este punto.
 *
 * FALLA CERRADO. Si Supabase no responde, no se llama a Gemini. Dejar pasar
 * cuando el contador no funciona convertiría «tumbar la base de datos» en la
 * forma de saltarse el límite, y además una aplicación sin base de datos no
 * podría responder la pregunta de todos modos.
 */

/** Identificadores de las dos ventanas. Uno por fila en `rate_limits`. */
const MINUTE_ID = "chat:minuto";
const DAY_ID = "chat:dia";

export interface WindowResult {
  allowed: boolean;
  hits: number;
  retryAfterSeconds: number;
}

export interface LimitDecision {
  allowed: boolean;
  /** Qué ventana cortó. `null` si pasó. */
  scope: "minuto" | "dia" | null;
  retryAfterSeconds: number;
}

/**
 * Normaliza la fila de `register_rate_hit`.
 *
 * PURO, como `toLockState`. Una fila ilegible BLOQUEA: si no se entiende la
 * respuesta del contador, no se sabe cuántos mensajes van, y en la duda no se
 * gasta cuota.
 */
export function toWindowResult(row: unknown): WindowResult {
  if (typeof row !== "object" || row === null) {
    return { allowed: false, hits: 0, retryAfterSeconds: MINUTE_WINDOW_SECONDS };
  }

  const { hits, allowed, retry_after_seconds: retry } = row as {
    hits?: unknown;
    allowed?: unknown;
    retry_after_seconds?: unknown;
  };

  if (typeof allowed !== "boolean") {
    return { allowed: false, hits: 0, retryAfterSeconds: MINUTE_WINDOW_SECONDS };
  }

  return {
    allowed,
    hits: typeof hits === "number" ? hits : 0,
    retryAfterSeconds: typeof retry === "number" && retry > 0 ? Math.ceil(retry) : 0,
  };
}

/**
 * Manda la ventana más restrictiva.
 *
 * Empatadas —las dos cortan— gana el minuto: su espera es de segundos y es el
 * consejo útil. Decirle a alguien que vuelva mañana cuando en diez segundos
 * puede seguir sería mentirle.
 */
export function combineWindows(minute: WindowResult, day: WindowResult): LimitDecision {
  if (!minute.allowed) {
    return {
      allowed: false,
      scope: "minuto",
      retryAfterSeconds: minute.retryAfterSeconds || MINUTE_WINDOW_SECONDS,
    };
  }

  if (!day.allowed) {
    return {
      allowed: false,
      scope: "dia",
      retryAfterSeconds: day.retryAfterSeconds || DAY_WINDOW_SECONDS,
    };
  }

  return { allowed: true, scope: null, retryAfterSeconds: 0 };
}

/**
 * Anota el mensaje en las dos ventanas y decide.
 *
 * Las dos llamadas van en paralelo: son independientes y en serie pagarían dos
 * idas y vueltas a Supabase antes de la primera palabra de la respuesta.
 *
 * Se cuenta ANTES de llamar al modelo, y se cuenta aunque luego la respuesta
 * falle. Contar solo los aciertos permitiría gastar cuota sin límite mientras
 * las peticiones fallaran, que es justo cuando más conviene frenar.
 *
 * @throws ChatError si el contador no responde.
 */
export async function registerChatHit(): Promise<LimitDecision> {
  const supabase = getSupabaseAdmin();

  const hit = (id: string, limit: number, windowSeconds: number) =>
    supabase.rpc("register_rate_hit", {
      p_id: id,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

  const [minute, day] = await Promise.all([
    hit(MINUTE_ID, MESSAGES_PER_MINUTE, MINUTE_WINDOW_SECONDS),
    hit(DAY_ID, MESSAGES_PER_DAY, DAY_WINDOW_SECONDS),
  ]);

  const failure = minute.error ?? day.error;
  if (failure) {
    // El nombre de la función va al log para que la causa más probable —que
    // nadie ejecutó `npm run db:init` tras desplegar— se lea de un vistazo.
    throw generic("ai.chat.rate_rpc_failed", {
      funcion: "register_rate_hit",
      detalle: failure.message,
    });
  }

  // La función devuelve un conjunto de una fila. Sin tipos generados de Supabase
  // `data` es `any`, así que se estrecha aquí, en un solo punto.
  const firstRow = (data: unknown) => (Array.isArray(data) ? data[0] : data);

  return combineWindows(
    toWindowResult(firstRow(minute.data)),
    toWindowResult(firstRow(day.data)),
  );
}
