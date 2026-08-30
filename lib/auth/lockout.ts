import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Freno de fuerza bruta sobre el PIN.
 *
 * Un PIN de 4 dígitos son 10 000 combinaciones: con peticiones automatizadas se
 * agotan en minutos. Lo único que lo impide de verdad es limitar los intentos, y
 * tiene que ser en servidor — bloquear en el navegador no molesta a quien llama
 * al endpoint con `curl`.
 *
 * Se apoya en Supabase, que ya está ahí, en lugar de montar un Redis para esto.
 * El contador es GLOBAL: la aplicación tiene un usuario, y limitar por IP dejaría
 * recorrer el espacio de PINs rotando direcciones. A cambio, alguien puede
 * dejarte fuera 15 minutos a propósito; para un presupuesto personal compensa.
 *
 * El PIN introducido no se guarda ni se registra en ningún punto de este módulo.
 */

/** Clave del contador. Una sola: el límite es global. */
const COUNTER_ID = "login";

/** Intentos fallidos consecutivos antes de bloquear. */
export const MAX_ATTEMPTS = 5;

/** Cuánto dura el bloqueo. */
export const LOCK_MINUTES = 15;

export interface LockState {
  locked: boolean;
  /** Segundos que faltan para poder reintentar. `0` si no está bloqueado. */
  retryAfterSeconds: number;
}

const UNLOCKED: LockState = { locked: false, retryAfterSeconds: 0 };

function toLockState(lockedUntil: string | null, now: number): LockState {
  if (!lockedUntil) return UNLOCKED;

  const remainingMs = Date.parse(lockedUntil) - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return UNLOCKED;

  return { locked: true, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
}

/**
 * ¿Se admiten intentos ahora mismo?
 *
 * Se consulta ANTES de comprobar el PIN, para no gastar una derivación scrypt
 * —que es cara a propósito— en una petición que se va a rechazar igualmente.
 *
 * Si Supabase no responde, se bloquea. Sin contador no hay defensa contra la
 * fuerza bruta, y una aplicación sin base de datos no sirve de nada de todos
 * modos: fallar cerrado no cuesta funcionalidad real y evita que tumbar la base
 * de datos sea la forma de saltarse el límite.
 */
export async function checkLock(now: number = Date.now()): Promise<LockState> {
  const { data, error } = await getSupabaseAdmin()
    .from("auth_attempts")
    .select("locked_until")
    .eq("id", COUNTER_ID)
    .maybeSingle<{ locked_until: string | null }>();

  if (error) throw new Error(`No se pudo consultar el control de intentos: ${error.message}`);

  return toLockState(data?.locked_until ?? null, now);
}

/**
 * Anota el resultado de un intento y devuelve el estado resultante.
 *
 * La cuenta la lleva una función de PostgreSQL, no este código: sumar desde aquí
 * exigiría leer y escribir en dos pasos, y cien peticiones simultáneas leerían el
 * mismo valor y probarían cien PINs con un único fallo contabilizado.
 */
export async function registerAttempt(
  success: boolean,
  now: number = Date.now(),
): Promise<LockState> {
  const { data, error } = await getSupabaseAdmin().rpc("register_auth_attempt", {
    p_id: COUNTER_ID,
    p_success: success,
    p_max: MAX_ATTEMPTS,
    p_lock_minutes: LOCK_MINUTES,
  });

  if (error) throw new Error(`No se pudo registrar el intento: ${error.message}`);

  // La función devuelve un conjunto de una fila. Sin tipos generados de
  // Supabase, `data` es `any`, así que se estrecha aquí en un solo punto.
  const [row] = (data ?? []) as Array<{ failed_count: number; locked_until: string | null }>;

  return toLockState(row?.locked_until ?? null, now);
}
