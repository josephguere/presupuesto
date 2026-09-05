import { isBcpConsumoEmail, parseBcpConsumoEmail } from "./bcpConsumo";
import { isBcpPagoServicioEmail, parseBcpPagoServicioEmail } from "./bcpPagoServicio";
import { isBcpTransferenciaEmail, parseBcpTransferenciaEmail } from "./bcpTransferencia";
import type { ParseResult, ParsedTransaction } from "./types";

/**
 * Punto de entrada de los correos del BCP.
 *
 * Aquí —y solo aquí— se decide a qué parser va cada correo. La API llama siempre
 * a `parseBcpEmail()` y no se entera de cuántos formatos hay detrás.
 *
 * Un parser por tipo de correo, y no ramas dentro de uno solo, porque cada tipo
 * tiene sus propias etiquetas y su propia idea de cuál es «el importe»: en un
 * consumo es el total del consumo, en un pago de servicios el monto total del
 * recibo, y en una transferencia el total cobrado con comisión incluida.
 * Mezclarlos en un archivo haría que un cambio del banco en un formato pudiera
 * romper los otros dos.
 *
 * El orden es por frecuencia: los consumos son la mayoría del correo diario.
 * Los marcadores no se solapan —«realizaste un consumo», «pago de servicios»,
 * «realizaste una transferencia»—, así que el orden solo afecta a la velocidad,
 * y hay una prueba que verifica que ningún parser reclame un correo ajeno.
 */
const PARSERS = [
  { matches: isBcpConsumoEmail, parse: parseBcpConsumoEmail },
  { matches: isBcpPagoServicioEmail, parse: parseBcpPagoServicioEmail },
  { matches: isBcpTransferenciaEmail, parse: parseBcpTransferenciaEmail },
] as const;

export function parseBcpEmail(rawBody: string): ParseResult<ParsedTransaction> {
  for (const parser of PARSERS) {
    if (parser.matches(rawBody)) return parser.parse(rawBody);
  }

  // Ninguno lo reconoce. Se devuelve el error del parser de consumos porque es
  // el caso mayoritario y su mensaje es el más útil al depurar.
  return parseBcpConsumoEmail(rawBody);
}

/** ¿El cuerpo corresponde a alguna notificación del BCP que sepamos leer? */
export function isBcpEmail(rawBody: string): boolean {
  return PARSERS.some((parser) => parser.matches(rawBody));
}

export {
  parseBcpConsumoEmail,
  isBcpConsumoEmail,
  parseBcpPagoServicioEmail,
  isBcpPagoServicioEmail,
  parseBcpTransferenciaEmail,
  isBcpTransferenciaEmail,
};
export type { ParseResult, ParsedTransaction };
