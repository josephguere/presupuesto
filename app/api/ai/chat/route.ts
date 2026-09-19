import { NextResponse } from "next/server";
import { z } from "zod";
import { hasValidSession } from "@/lib/auth/guard";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { resolvePeriod } from "@/lib/period";
import { logger } from "@/lib/logger";
import { isChatConfigured } from "@/lib/ai/config";
import {
  badQuestion,
  noSession,
  notConfigured,
  rateLimited,
  toErrorResponse,
} from "@/lib/ai/errors";
import { startDeadline } from "@/lib/ai/deadline";
import { registerChatHit } from "@/lib/ai/rateLimit";
import { loadCatalog } from "@/lib/ai/catalog";
import { callAnswer, callIntent } from "@/lib/ai/gemini";
import { historyNote, parseIntent } from "@/lib/ai/intent";
import { executeIntent } from "@/lib/ai/execute";
import { toAnswerPayload, toChatResult } from "@/lib/ai/present";
import { finalAnswer } from "@/lib/ai/answer";
import {
  EMPTY_RESULT_MESSAGE,
  FUTURE_PERIOD_MESSAGE,
  MAX_HISTORY_CHARS,
  MAX_HISTORY_MESSAGES,
  MAX_QUESTION_LENGTH,
  MIN_QUESTION_LENGTH,
  REQUEST_BUDGET_MS,
} from "@/lib/ai/limits";
import type { ChatFailure, ChatReply } from "@/lib/chat/types";

/**
 * POST /api/ai/chat — responde preguntas sobre los movimientos del usuario.
 *
 * SOLO LECTURA. No hay ninguna ruta desde aquí hasta un INSERT, un UPDATE o un
 * DELETE: se consulta con `lib/ai/execute.ts`, que solo sabe usar la capa de
 * lectura de `lib/transactions.ts`.
 *
 * El orden de los pasos NO es intercambiable:
 *
 *   1. Sesión.        Antes de leer el cuerpo y antes de tocar nada.
 *   2. Configuración. Sin Supabase o sin clave no hay nada que intentar.
 *   3. Cuerpo.        Validado con zod; la pregunta tiene tope de longitud.
 *   4. Límite.        ANTES de llamar al modelo, que es lo que cuesta dinero.
 *   5. Presupuesto.   Un reloj para toda la petición.
 *   6. Catálogo.      Lo que existe hoy, para que el modelo no nombre otra cosa.
 *   7. Intención.     Primera llamada. Devuelve solo estructura, nunca prosa.
 *   8. Validación.    Se rechaza lo imposible sin consultar nada.
 *   9. Consulta.      Supabase, con los filtros ya validados.
 *  10. Redacción.     Segunda llamada, solo con los hechos obtenidos.
 *
 * CUATRO CORTOCIRCUITOS se ahorran la segunda llamada porque no hay nada que
 * redactar: fuera de alcance, intención incoherente, período futuro y cero filas.
 * Es la mitad del gasto en los casos más frecuentes.
 *
 * NO se usan `parseFilters` ni `withDefaultMonth`. `withDefaultMonth` impone el
 * mes en curso cuando no hay período, y aquí «todo el historial» es una petición
 * explícita del usuario que quedaría convertida en «este mes» sin ningún síntoma.
 *
 * LA PREGUNTA DEL USUARIO NO SE REGISTRA. Se registran su longitud, la intención
 * elegida y los tiempos. El texto es lo más personal que pasa por aquí y los logs
 * de Vercel los lee cualquiera con acceso al panel.
 */

// El SDK de Gemini y Supabase necesitan Node; y esto no se cachea nunca.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Techo de la plataforma.
 *
 * Tiene que quedar POR ENCIMA de `REQUEST_BUDGET_MS` y por debajo del tope del
 * cliente. Ver la cadena de tiempos en `lib/ai/limits.ts`.
 */
export const maxDuration = 30;

const TurnSchema = z
  .object({
    role: z.enum(["usuario", "asistente"]),
    text: z.string().max(MAX_HISTORY_CHARS),
  })
  .strict();

const BodySchema = z
  .object({
    question: z.string().trim().min(MIN_QUESTION_LENGTH).max(MAX_QUESTION_LENGTH),
    history: z.array(TurnSchema).max(MAX_HISTORY_MESSAGES).default([]),
  })
  .strict();

export async function POST(request: Request): Promise<NextResponse<ChatReply | ChatFailure>> {
  const deadline = startDeadline(REQUEST_BUDGET_MS);

  try {
    // 1. Sesión. El proxy ya redirige a quien no la tenga, pero eso es navegación:
    //    un Route Handler es un endpoint público que lee con la service_role key.
    if (!(await hasValidSession())) throw noSession();

    // 2. Configuración.
    const supabaseOk = isSupabaseConfigured();
    const geminiOk = isChatConfigured();
    if (!supabaseOk || !geminiOk) {
      throw notConfigured({ gemini: !geminiOk, supabase: !supabaseOk });
    }

    // 3. Cuerpo.
    const body = await readBody(request);

    // 4. Límite de consumo, antes de gastar cuota.
    const limite = await registerChatHit();
    if (!limite.allowed) {
      throw rateLimited(limite.scope ?? "minuto", limite.retryAfterSeconds);
    }

    const now = new Date();

    // 6. El catálogo vigente: qué categorías existen HOY.
    const catalog = await loadCatalog(deadline.signal);

    // 7. Pregunta → intención estructurada.
    const intentCall = await callIntent({
      question: body.question,
      history: body.history,
      catalog,
      now,
      deadline,
    });

    // 8. Validación. Lo imposible muere aquí, sin tocar Supabase.
    const parsed = parseIntent(intentCall.value, catalog, now);

    if (!parsed.ok) {
      logger.info("ai.chat.rejected", {
        motivo: parsed.rechazo.motivo,
        detalle: parsed.rechazo.detalle,
        elapsedMs: deadline.elapsedMs(),
      });

      // Cortocircuito 1 y 2: fuera de alcance e intención incoherente. El texto
      // lo escribió el servidor, así que no hace falta una segunda llamada.
      return NextResponse.json({
        ok: true,
        text: parsed.rechazo.mensaje,
        result: null,
        intent: parsed.rechazo.motivo,
        historyNote: null,
        truncated: false,
      });
    }

    const intent = parsed.intent;
    const period = resolvePeriod(intent.periodo, now);
    const nota = historyNote(intent, period);

    // Cortocircuito 3: un período que aún no ha ocurrido no tiene movimientos.
    if (period.isFuture) {
      logger.info("ai.chat.future", { intencion: intent.intencion });

      return NextResponse.json({
        ok: true,
        text: `${FUTURE_PERIOD_MESSAGE} Período pedido: ${period.label}.`,
        result: null,
        intent: intent.intencion,
        historyNote: nota,
        truncated: false,
      });
    }

    // 9. La consulta.
    const comparePeriod =
      intent.intencion === "period_comparison"
        ? resolvePeriod(intent.periodoComparado, now)
        : undefined;

    const result = await executeIntent(intent, period, {
      signal: deadline.signal,
      comparePeriod,
    });

    const payload = toAnswerPayload(result);

    // Cortocircuito 4: sin filas no hay nada que redactar, y una frase del
    // servidor lo dice mejor —y gratis— que una segunda llamada al modelo.
    if (result.vacio) {
      logger.info("ai.chat.empty", {
        intencion: intent.intencion,
        periodo: period.kind,
        elapsedMs: deadline.elapsedMs(),
      });

      return NextResponse.json({
        ok: true,
        text: [EMPTY_RESULT_MESSAGE, `Período consultado: ${period.label}.`, ...result.avisos].join(
          " ",
        ),
        result: null,
        intent: intent.intencion,
        historyNote: nota,
        truncated: result.truncado,
      });
    }

    // 10. Redacción, con los hechos y nada más.
    const answerCall = await callAnswer({
      question: body.question,
      payload,
      deadline,
    });

    // Y la comprobación de que no se inventó ninguna cifra.
    const { text, fuente } = finalAnswer(answerCall.value, payload);

    logger.info("ai.chat.answered", {
      intencion: intent.intencion,
      periodo: period.kind,
      filas: result.totalFilas,
      truncado: result.truncado,
      fuente,
      preguntaLongitud: body.question.length,
      tokens: intentCall.usage.output + answerCall.usage.output,
      elapsedMs: deadline.elapsedMs(),
    });

    return NextResponse.json({
      ok: true,
      text,
      result: toChatResult(result),
      intent: intent.intencion,
      historyNote: nota,
      truncated: result.truncado,
    });
  } catch (error) {
    return toErrorResponse(error, deadline.elapsedMs());
  } finally {
    // Un `setTimeout` pendiente alarga la invocación después de haber respondido.
    deadline.release();
  }
}

/**
 * El cuerpo, validado.
 *
 * Un fallo de zod se convierte en el error de «pregunta», que lleva un mensaje
 * accionable. Se registra la LONGITUD, nunca el texto.
 */
async function readBody(request: Request): Promise<z.infer<typeof BodySchema>> {
  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    throw badQuestion(0);
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    const question = (raw as { question?: unknown })?.question;
    throw badQuestion(typeof question === "string" ? question.length : 0);
  }

  return parsed.data;
}
