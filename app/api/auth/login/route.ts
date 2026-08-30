import { NextResponse } from "next/server";
import { z } from "zod";
import { getConfiguredPinHash, isValidPinFormat, verifyPin } from "@/lib/auth/pin";
import { checkLock, registerAttempt } from "@/lib/auth/lockout";
import {
  SESSION_COOKIE,
  createSessionToken,
  getSessionSecret,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { describeError, logger } from "@/lib/logger";

/**
 * POST /api/auth/login — canjea el PIN por una sesión.
 *
 * Es el único sitio donde se comprueba el PIN, y ocurre entero en el servidor:
 * el navegador jamás recibe el hash ni nada con lo que pudiera adivinarlo.
 *
 * ORDEN DE LAS COMPROBACIONES. Primero el bloqueo, después el PIN. Al revés se
 * gastaría una derivación scrypt —cara a propósito— en peticiones que se van a
 * rechazar igual, y eso convertiría el propio login en una forma barata de tumbar
 * el servidor.
 *
 * QUÉ SE DEVUELVE. Un mensaje fijo por situación y nada más. Ni si el PIN tenía
 * el formato correcto, ni cuántos intentos quedan, ni si la configuración está
 * completa: cualquiera de esos detalles ayuda a quien está probando a ciegas.
 */

// scrypt vive en node:crypto y el control de intentos escribe en base de datos.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mensajes visibles. Deliberadamente pocos y sin detalle técnico. */
const WRONG_PIN = "Código incorrecto";
const TOO_MANY = "Demasiados intentos. Intenta nuevamente más tarde.";
const UNAVAILABLE = "No se pudo verificar el código. Intenta nuevamente.";

/** El PIN entra como string: `0042` no es el número 42. */
const LoginSchema = z.object({ pin: z.string() }).strict();

export async function POST(request: Request): Promise<NextResponse> {
  const secret = getSessionSecret();
  const storedHash = getConfiguredPinHash();

  if (!secret || !storedHash) {
    // Se registra QUÉ falta, nunca su valor. Y hacia fuera, un mensaje neutro.
    logger.error("auth.not_configured", {
      missingPinHash: !storedHash,
      missingSessionSecret: !secret,
    });
    return NextResponse.json({ ok: false, message: UNAVAILABLE }, { status: 503 });
  }

  let pin: string;
  try {
    const body = LoginSchema.parse(await request.json());
    pin = body.pin;
  } catch {
    // Cuerpo ilegible: no cuenta como intento, no hay nada que adivinar en él.
    return NextResponse.json({ ok: false, message: WRONG_PIN }, { status: 400 });
  }

  // Un PIN mal formado no puede acertar, así que tampoco gasta un intento: si
  // contara, un fallo de la interfaz podría dejar al usuario fuera 15 minutos.
  if (!isValidPinFormat(pin)) {
    logger.warn("auth.invalid_format");
    return NextResponse.json({ ok: false, message: WRONG_PIN }, { status: 400 });
  }

  try {
    const lock = await checkLock();
    if (lock.locked) {
      logger.warn("auth.locked", { retryAfterSeconds: lock.retryAfterSeconds });
      return NextResponse.json(
        { ok: false, message: TOO_MANY },
        { status: 429, headers: { "Retry-After": String(lock.retryAfterSeconds) } },
      );
    }

    const correct = verifyPin(pin, storedHash);
    const state = await registerAttempt(correct);

    if (!correct) {
      // Nunca el PIN recibido, ni un fragmento, ni su longitud.
      logger.warn("auth.failed", { locked: state.locked });

      if (state.locked) {
        return NextResponse.json(
          { ok: false, message: TOO_MANY },
          { status: 429, headers: { "Retry-After": String(state.retryAfterSeconds) } },
        );
      }

      return NextResponse.json({ ok: false, message: WRONG_PIN }, { status: 401 });
    }

    const token = await createSessionToken(secret);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());

    logger.info("auth.success");
    return response;
  } catch (error) {
    // Incluye que Supabase no responda: sin contador no hay freno a la fuerza
    // bruta, así que se cierra la puerta en vez de dejarla abierta.
    logger.error("auth.error", { error: describeError(error) });
    return NextResponse.json({ ok: false, message: UNAVAILABLE }, { status: 503 });
  }
}
