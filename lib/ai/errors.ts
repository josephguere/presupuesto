import { NextResponse } from "next/server";
import { describeError, logger } from "@/lib/logger";
import {
  DAILY_LIMIT_MESSAGE,
  GENERIC_ERROR_MESSAGE,
  QUESTION_TOO_LONG_MESSAGE,
  QUOTA_MESSAGE,
  SESSION_MESSAGE,
  TOO_FAST_MESSAGE,
} from "./limits";
import type { ChatErrorCode, ChatFailure } from "@/lib/chat/types";

/**
 * Toda la cadena de errores del chat, en una sola clase.
 *
 * Cada error nace sabiendo ya su código HTTP, su mensaje visible, su `Retry-After`
 * y su evento de log. Eso permite que el Route Handler tenga UN `try`, UN `catch`
 * y un único punto de salida, en lugar de repartir la decisión de qué contarle al
 * usuario por diez sitios distintos.
 *
 * LA REGLA: el mensaje visible NUNCA lleva el detalle técnico. Lo que dice el SDK
 * de Google o PostgREST va al log del servidor y se queda ahí; el usuario ve una
 * de las frases fijas de `limits.ts`. Un mensaje de error de un tercero puede
 * contener trozos de la petición, y eso incluye la clave.
 */

export class ChatError extends Error {
  readonly code: ChatErrorCode;
  readonly status: number;
  readonly userMessage: string;
  readonly retryAfterSeconds: number;
  readonly logEvent: string;
  readonly logData: Record<string, string | number | boolean>;

  constructor(init: {
    code: ChatErrorCode;
    status: number;
    userMessage: string;
    logEvent: string;
    retryAfterSeconds?: number;
    logData?: Record<string, string | number | boolean>;
  }) {
    // El `message` es para el log; el usuario ve `userMessage`.
    super(init.logEvent);
    this.name = "ChatError";
    this.code = init.code;
    this.status = init.status;
    this.userMessage = init.userMessage;
    this.retryAfterSeconds = init.retryAfterSeconds ?? 0;
    this.logEvent = init.logEvent;
    this.logData = init.logData ?? {};
  }
}

/* -------------------------------------------------------------------------- */
/* Constructores                                                               */
/* -------------------------------------------------------------------------- */

/** La pregunta no cumple los límites. Se registra la LONGITUD, nunca el texto. */
export function badQuestion(length: number): ChatError {
  return new ChatError({
    code: "pregunta",
    status: 400,
    userMessage: QUESTION_TOO_LONG_MESSAGE,
    logEvent: "ai.chat.bad_question",
    logData: { length },
  });
}

export function noSession(): ChatError {
  return new ChatError({
    code: "sesion",
    status: 401,
    userMessage: SESSION_MESSAGE,
    logEvent: "ai.chat.no_session",
  });
}

export function rateLimited(scope: "minuto" | "dia", retryAfterSeconds: number): ChatError {
  return new ChatError({
    code: scope === "dia" ? "limite_diario" : "limite",
    status: 429,
    userMessage: scope === "dia" ? DAILY_LIMIT_MESSAGE : TOO_FAST_MESSAGE,
    retryAfterSeconds,
    logEvent: "ai.chat.rate_limited",
    logData: { scope, retryAfterSeconds },
  });
}

/**
 * Falta configuración.
 *
 * Se registran los NOMBRES de lo que falta, nunca los valores. El usuario ve el
 * mensaje genérico: que le falte una clave al servidor no es asunto suyo y
 * decírselo solo informaría a quien no debe.
 */
export function notConfigured(missing: { gemini: boolean; supabase: boolean }): ChatError {
  return new ChatError({
    code: "generico",
    status: 503,
    userMessage: GENERIC_ERROR_MESSAGE,
    logEvent: "ai.chat.not_configured",
    logData: { gemini: missing.gemini, supabase: missing.supabase },
  });
}

/** Cualquier otro fallo del servidor. */
export function generic(
  logEvent: string,
  data: Record<string, string | number | boolean> = {},
): ChatError {
  return new ChatError({
    code: "generico",
    status: 503,
    userMessage: GENERIC_ERROR_MESSAGE,
    logEvent,
    logData: data,
  });
}

/* -------------------------------------------------------------------------- */
/* Errores de Gemini                                                           */
/* -------------------------------------------------------------------------- */

/** Qué clase de fallo devolvió el modelo. */
export interface GeminiFailure {
  status: number | null;
  kind: "cuota" | "modelo" | "peticion" | "abortada" | "red";
}

/**
 * Clasifica lo que lanza el SDK.
 *
 * Se mira `error.status` numérico y, si no lo hay, se inspecciona el mensaje. NO
 * se importa la clase de error del SDK: hacerlo ataría este módulo a un detalle
 * interno que cambia entre versiones menores, y el `instanceof` fallaría en
 * silencio dejando todo como «red».
 */
export function classifyGeminiError(error: unknown): GeminiFailure {
  // Un aborto es lo que provoca nuestro propio presupuesto de tiempo.
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return { status: null, kind: "abortada" };
  }

  const status = readStatus(error);
  const message = describeError(error).toLowerCase();

  if (status === 429 || message.includes("resource_exhausted") || message.includes("quota")) {
    return { status, kind: "cuota" };
  }

  if (status === 404 || message.includes("not found") || message.includes("is not supported")) {
    return { status, kind: "modelo" };
  }

  if (status !== null && status >= 400 && status < 500) {
    return { status, kind: "peticion" };
  }

  if (message.includes("abort")) return { status, kind: "abortada" };

  return { status, kind: "red" };
}

/** `status` numérico allá donde el SDK lo haya dejado. */
function readStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;

  const candidate = error as { status?: unknown; code?: unknown };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.code === "number") return candidate.code;

  return null;
}

/**
 * Traduce un fallo del modelo al error del chat.
 *
 * Solo la cuota tiene mensaje propio, porque es el único caso en el que la
 * espera del usuario tiene sentido («inténtalo más tarde» es un consejo útil).
 * Un 404 de modelo o un fallo de red son problemas del servidor, y para el
 * usuario significan lo mismo: no se pudo.
 */
export function fromGemini(error: unknown, stage: "intencion" | "redaccion"): ChatError {
  const failure = classifyGeminiError(error);

  return new ChatError({
    code: failure.kind === "cuota" ? "cuota" : "generico",
    status: failure.kind === "cuota" ? 429 : 503,
    userMessage: failure.kind === "cuota" ? QUOTA_MESSAGE : GENERIC_ERROR_MESSAGE,
    logEvent: `ai.chat.gemini_${failure.kind}`,
    logData: {
      stage,
      status: failure.status ?? 0,
      detalle: scrubSecrets(describeError(error)),
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Salida                                                                      */
/* -------------------------------------------------------------------------- */

/** Longitud máxima del detalle técnico que llega al log. */
const MAX_LOG_DETAIL = 200;

/**
 * Limpia el mensaje antes de registrarlo.
 *
 * `describeError` reenvía tal cual lo que diga el SDK, y los errores HTTP suelen
 * incluir la URL de la petición —con la clave en la query— o cabeceras enteras.
 * Esto es una lista de denegación y por definición se queda corta; la defensa
 * real es que aquí solo entran mensajes de error, nunca cuerpos de petición.
 */
export function scrubSecrets(message: string): string {
  return message
    .replace(/key=[\w-]+/gi, "key=***")
    .replace(/AIza[\w-]{10,}/g, "***")
    .replace(/Bearer\s+[\w.\-]+/gi, "Bearer ***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LOG_DETAIL);
}

/**
 * Cualquier `throw` convertido en respuesta HTTP, con UNA línea de log.
 *
 * Lo que no es un `ChatError` —un fallo de Supabase, un `TypeError` nuestro— se
 * trata como genérico y se registra como error. Nunca se filtra su mensaje al
 * cuerpo de la respuesta.
 */
export function toErrorResponse(error: unknown, elapsedMs: number): NextResponse<ChatFailure> {
  const chatError =
    error instanceof ChatError
      ? error
      : new ChatError({
          code: "generico",
          status: 503,
          userMessage: GENERIC_ERROR_MESSAGE,
          logEvent: "ai.chat.failed",
          logData: { detalle: scrubSecrets(describeError(error)) },
        });

  const data = { ...chatError.logData, elapsedMs };

  // Lo que el usuario provoca (pregunta larga, ráfaga, sesión caducada) es
  // información; lo que falla de nuestro lado es un error que hay que ver.
  if (chatError.status >= 500) logger.error(chatError.logEvent, data);
  else if (chatError.status === 429) logger.warn(chatError.logEvent, data);
  else logger.info(chatError.logEvent, data);

  const body: ChatFailure = {
    ok: false,
    code: chatError.code,
    message: chatError.userMessage,
    retryAfterSeconds: chatError.retryAfterSeconds,
  };

  const headers: Record<string, string> = {};
  if (chatError.retryAfterSeconds > 0) {
    headers["Retry-After"] = String(chatError.retryAfterSeconds);
  }

  return NextResponse.json(body, { status: chatError.status, headers });
}
