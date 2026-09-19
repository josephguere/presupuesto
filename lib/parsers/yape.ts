import {
  deaccent,
  findValueByLabel,
  normalizeEmailBody,
  parseAmount,
  parseSpanishDateTime,
  toNormalizedBody,
  type NormalizedBody,
} from "./normalize";
import type { ParseResult, ParsedTransaction } from "./types";

/**
 * Parser de las notificaciones de Yape.
 *
 * Yape maqueta el correo como una lista de etiqueta sobre valor, una debajo de
 * otra y sin dos puntos:
 *
 *     ¡Acabas de yapear exitosamente!
 *
 *     Monto de yapeo
 *     S/ 55.00
 *
 *     Yapero
 *     Joseph Gue*
 *
 *     Fecha y Hora de la operación
 *     14 septiembre 2026 - 07:38 a. m.
 *
 *     Celular del Beneficiario
 *     XXXXXXXXX631
 *
 *     Nombre del Beneficiario
 *     Jafeth Ore*
 *
 *     N° de operación
 *     3229173
 *
 * Es exactamente la disposición B que ya contempla `findValueByLabel`, así que
 * la lectura de campos, los importes y las fechas en español se reutilizan tal
 * cual de `normalize.ts`. Este módulo solo aporta QUÉ etiquetas buscar y cómo se
 * mapean al modelo.
 *
 * DÓNDE VA CADA DATO, y por qué no hay columnas nuevas:
 *
 *     Monto            → amount            (siempre soles: Yape no opera en USD)
 *     Fecha y hora     → transactionAt     (un solo instante, como el resto)
 *     Beneficiario     → merchant          es el «Movimiento» de la interfaz
 *     Celular          → comment           junto al beneficiario, ver abajo
 *     N° de operación  → operationNumber
 *     —                → bank = YAPE       quién notificó la operación
 *
 * EL CELULAR VA EN EL COMENTARIO y no en una columna propia porque es el único
 * dato que distingue a dos beneficiarios con el mismo nombre visible, y Yape ya
 * lo entrega enmascarado («XXXXXXXXX631»): guardar los dígitos que el propio
 * correo muestra no añade nada que no estuviera ya en la bandeja de entrada.
 *
 * EL YAPERO —quien envía— NO se guarda: es siempre el dueño de la cuenta, así
 * que sería la misma cadena en todas las filas. Tampoco se usa para validar
 * nada, para no atar el parser al nombre de una persona concreta.
 *
 * El módulo es puro: entra texto, sale un resultado tipado. No conoce HTTP ni la
 * base de datos, así que se puede probar solo.
 */

/**
 * Frases que identifican una notificación de yapeo.
 *
 * Se comparan sin tildes ni mayúsculas. Como en los parsers del BCP, se mira el
 * CUERPO y no el asunto: el asunto es una frase de marketing («Por tu seguridad,
 * te notificaremos por cada yapeo que realices») que Yape puede reescribir
 * cualquier día sin cambiar el contenido.
 *
 * Son frases que solo aparecen en una notificación de operación, nunca en un
 * correo promocional, que es lo que evita registrar publicidad como si fuera
 * un gasto.
 */
const YAPE_MARKERS = [
  "acabas de yapear",
  "yapeaste",
  "monto de yapeo",
  "yapeo exitoso",
];

/**
 * Campos sin los cuales el movimiento no sirve.
 *
 * El beneficiario NO está aquí: si Yape dejara de enviarlo, un movimiento con
 * importe, fecha y número de operación sigue siendo un gasto real que conviene
 * registrar. Se rellena con un texto neutro y el usuario lo corrige.
 */
const REQUIRED_FIELDS = ["amount", "transactionAt", "operationNumber"] as const;

/** Lo que se pone como «Movimiento» cuando el correo no trae beneficiario. */
const UNKNOWN_BENEFICIARY = "Yape";

/** ¿Este cuerpo parece una notificación de yapeo? */
export function isYapeEmail(rawBody: string): boolean {
  if (typeof rawBody !== "string") return false;

  const haystack = deaccent(normalizeEmailBody(rawBody));
  return YAPE_MARKERS.some((marker) => haystack.includes(marker));
}

/**
 * Extrae la transacción de un correo de Yape.
 *
 * Nunca lanza: un correo con formato inesperado devuelve `{ ok: false }` con el
 * motivo, y el correo crudo se conserva igualmente en `email_ingestions` para
 * poder reprocesarlo cuando se corrija el parser.
 */
export function parseYapeEmail(rawBody: string): ParseResult<ParsedTransaction> {
  if (typeof rawBody !== "string" || rawBody.trim().length === 0) {
    return {
      ok: false,
      error: { code: "NOT_A_MATCH", message: "El cuerpo del correo está vacío." },
    };
  }

  if (!isYapeEmail(rawBody)) {
    return {
      ok: false,
      error: {
        code: "NOT_A_MATCH",
        message:
          "El correo no contiene ninguna frase de notificación de Yape " +
          `(esperada alguna de: ${YAPE_MARKERS.join(", ")}).`,
      },
    };
  }

  const body = toNormalizedBody(rawBody);

  // Yape escribe siempre en soles. `parseAmount` deduce la moneda del símbolo,
  // así que un correo con «S/» devuelve PEN sin que haya que forzarlo.
  const amount = parseAmount(
    findValueByLabel(body, ["Monto de yapeo", "Monto del yapeo", "Monto"]) ??
      matchFirst(body.text, /S\/\s*[\d.,]+/),
  );

  const transactionAt = parseSpanishDateTime(
    findValueByLabel(body, [
      "Fecha y Hora de la operación",
      "Fecha y hora de la operacion",
      "Fecha y hora",
      "Fecha",
    ]) ??
      // Respaldo: la fecha en cualquier parte del cuerpo, con el formato de
      // Yape («14 septiembre 2026 - 07:38 a. m.»), que no lleva los «de» del BCP.
      matchFirst(body.text, /(\d{1,2}\s+[A-Za-zÁÉÍÓÚáéíóú]+\s+\d{4}[^\n]*)/),
  );

  const operationNumber = normalizeOperationNumber(
    findValueByLabel(body, [
      "N° de operación",
      "Nro. de operación",
      "Número de operación",
      "Código de operación",
    ]) ?? matchFirst(body.text, /n[°º\s.o]*de operaci[oó]n[^\d\n]{0,12}(\d{3,})/i),
  );

  const missingFields = REQUIRED_FIELDS.filter((field) => {
    if (field === "amount") return amount === null;
    if (field === "transactionAt") return transactionAt === null;
    return operationNumber === null;
  });

  if (missingFields.length > 0) {
    return {
      ok: false,
      error: {
        code: "MISSING_FIELDS",
        message: `Faltan campos obligatorios en el correo de Yape: ${missingFields.join(", ")}.`,
        missingFields: [...missingFields],
      },
    };
  }

  const beneficiary = readBeneficiary(body);
  const phone = readBeneficiaryPhone(body);

  return {
    ok: true,
    data: {
      bank: "YAPE",
      // Fijo, no leído del correo: Yape no tiene un campo «tipo de operación» y
      // todas estas notificaciones son envíos salientes.
      operationType: YAPE_OPERATION_TYPE,
      transactionAt: transactionAt!,
      amount: amount!.amount,
      currency: amount!.currency,
      merchant: beneficiary ?? UNKNOWN_BENEFICIARY,
      // Yape no es una tarjeta: no hay cuatro dígitos que guardar.
      cardLast4: null,
      operationNumber: operationNumber!,
      comment: buildComment(beneficiary, phone),
      source: "GMAIL_YAPE",
    },
  };
}

/** Tipo de operación de todo yapeo saliente. */
export const YAPE_OPERATION_TYPE = "Yape enviado";

/**
 * Nombre del beneficiario, tal como lo escribe Yape (ya parcialmente oculto).
 *
 * DOS CAMINOS, porque Gmail entrega este correo en dos disposiciones distintas
 * y no hay forma de saber cuál va a tocar:
 *
 *   A) Cada etiqueta en su propia línea (la de la documentación de Yape).
 *      La cubre `findValueByLabel`, que mira el INICIO de cada línea.
 *
 *   B) Todo el bloque «Yapero ... Nº de operación NNNNN» convertido en UN SOLO
 *      PÁRRAFO por Gmail. Aquí «Nombre del Beneficiario» no está al principio
 *      de ninguna línea, así que `findValueByLabel` no lo ve — y es el caso
 *      real observado, no uno hipotético.
 *
 * El respaldo B ancla la etiqueta y para justo antes de la SIGUIENTE etiqueta
 * conocida («Nº de operación»), que siempre viene después en este correo.
 */
function readBeneficiary(body: NormalizedBody): string | null {
  const value =
    findValueByLabel(body, [
      "Nombre del Beneficiario",
      "Nombre del beneficiario",
      "Beneficiario",
    ]) ?? matchInline(body.text, /nombre del beneficiario/i, /n[°º]\.?\s*de\s*operaci[oó]n/i);

  const cleaned = value?.trim();
  return cleaned && cleaned.length > 0 ? cleaned.slice(0, 200) : null;
}

/**
 * Celular del beneficiario, ya enmascarado por Yape.
 *
 * Mismo respaldo que el nombre, y misma razón: cuando el correo llega como un
 * párrafo, «Celular del Beneficiario» tampoco está al inicio de línea.
 *
 * Se exige que el resultado tenga la forma que usa Yape —equis y unos pocos
 * dígitos— para no acabar copiando un número completo si algún día cambiaran
 * el formato; eso no cambia entre los dos caminos.
 */
function readBeneficiaryPhone(body: NormalizedBody): string | null {
  const value = (
    findValueByLabel(body, [
      "Celular del Beneficiario",
      "Celular del beneficiario",
      "Celular",
    ]) ?? matchInline(body.text, /celular del beneficiario/i, /nombre del beneficiario/i)
  )?.trim();

  if (!value) return null;

  return /^[X*x•\s]*\d{3,4}$/.test(value) ? value.replace(/\s+/g, "") : null;
}

/**
 * Valor entre una etiqueta y la SIGUIENTE etiqueta conocida, en cualquier
 * parte del texto — no solo al inicio de línea.
 *
 * Es el respaldo para cuando Gmail apelmaza varias etiquetas de Yape en un
 * único párrafo. Sin un límite explícito, capturar «hasta el final de línea»
 * se tragaría también la etiqueta siguiente y su valor.
 */
function matchInline(text: string, label: RegExp, nextLabel: RegExp): string | null {
  const pattern = new RegExp(
    `${label.source}\\s+([\\s\\S]+?)\\s+(?=${nextLabel.source})`,
    "i",
  );

  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

/**
 * El comentario del movimiento: a quién se le yapeó.
 *
 * Se construye aquí y no al pintar para que quede GUARDADO: el usuario puede
 * editarlo después como cualquier otro comentario, y si se calculara en la
 * interfaz esa edición se perdería en cada render.
 */
function buildComment(beneficiary: string | null, phone: string | null): string {
  const destino = beneficiary ?? "un contacto";
  return phone ? `Yape a ${destino} · ${phone}` : `Yape a ${destino}`;
}

/** Primer grupo de captura de un regex, o la coincidencia entera si no tiene. */
function matchFirst(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  if (!match) return null;
  return (match[1] ?? match[0])?.trim() || null;
}

/**
 * Deja el número de operación en solo dígitos.
 *
 * Yape lo escribe limpio («3229173»), pero un correo reenviado o convertido a
 * texto puede arrastrar espacios o puntos. Los ceros a la izquierda se
 * conservan: forman parte del identificador.
 */
function normalizeOperationNumber(value: string | null): string | null {
  if (!value) return null;

  const digits = value.replace(/\D/g, "");
  return digits.length >= 3 ? digits : null;
}
