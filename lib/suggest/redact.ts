/**
 * Depuración del texto que sale hacia Gemini.
 *
 * Omitir columnas no basta. El comentario que rellena la ingesta contiene cosas
 * como «PAGO CON NUMERO TELEFONO · 979336700»: el teléfono va DENTRO de un campo
 * que sí queremos enviar, porque su primera mitad («PAGO CON NUMERO TELEFONO»)
 * es justo lo que ayuda a clasificar.
 *
 * Así que el comentario se recorta, no se descarta:
 *
 *   1. Se corta por el «·» — el parser pone ahí el identificador del cliente.
 *   2. Se borra cualquier ristra larga de dígitos que sobreviva.
 *   3. Se limita la longitud, porque un comentario escrito a mano puede contener
 *      cualquier cosa que el usuario haya tecleado.
 *
 * Es una lista de denegación, y las listas de denegación se quedan cortas por
 * definición. Por eso la defensa de verdad no es esta: es que a Gemini solo se
 * le manda comercio, tipo, comentario recortado y monto, y que su respuesta está
 * restringida al catálogo. Esto reduce el daño, no lo elimina.
 */

/** Más de esto no aporta a una clasificación y sí aumenta lo que se expone. */
const MAX_LENGTH = 120;

/** Cinco dígitos seguidos ya no son un importe: son un identificador. */
const LONG_DIGITS = /\d{5,}/g;

/** Correos completos: se deja el dominio, que sí clasifica. */
const EMAIL = /[\w.+-]+@([\w-]+\.[\w.-]+)/g;

export function redactComment(comment: string | null | undefined): string | null {
  if (!comment) return null;

  // El parser compone «Servicio · Código de usuario». La izquierda dice qué se
  // pagó; la derecha es el número de línea o de suministro.
  const [head] = comment.split("·");

  const clean = head
    .replace(EMAIL, "$1")
    .replace(LONG_DIGITS, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LENGTH);

  return clean.length > 0 ? clean : null;
}

/**
 * Recorta el nombre del comercio a lo razonable.
 *
 * Un comercio no ocupa ochenta caracteres. Si llega algo más largo, o es basura
 * o es alguien intentando meter instrucciones por la puerta de atrás.
 */
export function redactMerchant(merchant: string | null | undefined): string {
  return (merchant ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}
