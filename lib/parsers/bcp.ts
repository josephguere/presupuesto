import { isBcpConsumoEmail, parseBcpConsumoEmail } from "./bcpConsumo";
import type { ParseResult, ParsedTransaction } from "./types";

/**
 * Punto de entrada de los correos del BCP.
 *
 * Débito y crédito comparten formato, así que hoy esto delega directo. Cuando
 * aparezca un correo del BCP con otra estructura (transferencias, Yape), aquí
 * — y solo aquí — se decide a qué parser va. La API llama siempre a
 * `parseBcpEmail()` y nunca cambia.
 */
export function parseBcpEmail(rawBody: string): ParseResult<ParsedTransaction> {
  return parseBcpConsumoEmail(rawBody);
}

/** ¿El cuerpo corresponde a alguna notificación del BCP que sepamos leer? */
export function isBcpEmail(rawBody: string): boolean {
  return isBcpConsumoEmail(rawBody);
}

export { parseBcpConsumoEmail, isBcpConsumoEmail };
export type { ParseResult, ParsedTransaction };
