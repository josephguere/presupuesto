/**
 * Logging estructurado mínimo.
 *
 * Una línea por evento, con un prefijo estable para poder filtrar en los logs de
 * Vercel. No es un framework de observabilidad: es lo justo para depurar la
 * ingesta sin adivinar.
 *
 * REGLA: aquí nunca entran secretos. Ni `SUPABASE_SERVICE_ROLE_KEY`, ni
 * `GMAIL_INGEST_KEY`, ni la cabecera `x-ingest-key`, ni el cuerpo completo del
 * correo. Se registran identificadores, estados y longitudes.
 */

type LogLevel = "info" | "warn" | "error";

/** Valores seguros de registrar: identificadores, estados, contadores. */
type LogData = Record<string, string | number | boolean | null | undefined>;

function emit(level: LogLevel, event: string, data?: LogData): void {
  const payload = data ? ` ${JSON.stringify(data)}` : "";
  const line = `[presupuesto] ${event}${payload}`;

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const logger = {
  info: (event: string, data?: LogData) => emit("info", event, data),
  warn: (event: string, data?: LogData) => emit("warn", event, data),
  error: (event: string, data?: LogData) => emit("error", event, data),
};

/**
 * Convierte cualquier `catch` en un mensaje legible.
 *
 * Los errores de supabase-js no siempre son `Error`, así que normalizamos antes
 * de guardarlos en `processing_error` o de sacarlos por el log.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Error desconocido";
  }
}
