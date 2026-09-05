import {
  deaccent,
  findEmphasizedValue,
  findMaskedDigitsAfterLabel,
  findValueByLabel,
  normalizeEmailBody,
  parseAmount,
  parseSpanishDateTime,
  toNormalizedBody,
  type NormalizedBody,
} from "./normalize";
import type { ParseResult, ParsedTransaction } from "./types";

/**
 * Parser de las constancias de pago de servicios del BCP.
 *
 * FORMATO REAL, tal como lo entrega `getPlainBody()` de Apps Script. No hay
 * tablas ni tabuladores: el banco apelotona media docena de campos en un solo
 * renglón y pone los valores en negrita, que en texto plano son asteriscos.
 *
 *     Operación realizada:
 *     *Pago de servicios*
 *     Número de operación:
 *     *01208745*
 *     Fecha y hora: *Jueves, 03 Septiembre 2026 - 10:18 A. M.* Empresa:
 *     *ELECTRO UCAYALI* Servicio: *CONSUMO* Titular del servicio: *GARCIA
 *     TORRES , BENJAMIN* Código de usuario: *148375* Comisión: ** Cuenta de
 *     origen: *Tarjeta de crédito
 *     **** 2437
 *     JOSEPH ABAD* Vigencia: ** ... Monto total: *S/ 174.20* ...
 *     Nº 1 Nº 2 Doc. pago: *0000...* ** Vencimiento: *23/08/2026* ** Importe:
 *     *S/ 174.20* ** Cargo fijo: *S/ 0.00* ** Mora: *S/ 0.00* **
 *
 * Por eso se lee con `findEmphasizedValue`, que busca la etiqueta en cualquier
 * punto del texto y exige que el valor venga en negrita justo detrás. La lectura
 * por línea de `findValueByLabel` solo sirve aquí para los dos campos que sí
 * están al principio de su renglón.
 *
 * TRES DECISIONES QUE NO SON OBVIAS:
 *
 *   · El importe sale de `Monto total`, NO de `Importe`. Este último pertenece
 *     al bloque «Nº 1» de un recibo concreto, y el correo ya trae huecos para
 *     «Nº 2», «Nº 3» y «Nº 4»: al pagar varios de una vez, leer `Importe` daría
 *     solo el primero.
 *
 *   · La tarjeta no está en el valor de `Cuenta de origen` —que dice «Tarjeta de
 *     crédito»— sino en el renglón siguiente, dentro de la misma negrita.
 *
 *   · Un valor vacío se escribe `**`. Se trata como ausente, que es lo que es.
 */

/** Frases que identifican una constancia de pago de servicios. */
const PAYMENT_MARKERS = ["pago de servicios"];

/** Campos sin los cuales el movimiento no sirve. */
const REQUIRED_FIELDS = ["amount", "transactionAt", "operationNumber"] as const;

/** ¿Este cuerpo parece una constancia de pago de servicios del BCP? */
export function isBcpPagoServicioEmail(rawBody: string): boolean {
  const haystack = deaccent(normalizeEmailBody(rawBody));
  return PAYMENT_MARKERS.some((marker) => haystack.includes(marker));
}

export function parseBcpPagoServicioEmail(rawBody: string): ParseResult<ParsedTransaction> {
  if (typeof rawBody !== "string" || rawBody.trim().length === 0) {
    return {
      ok: false,
      error: { code: "NOT_A_MATCH", message: "El cuerpo del correo está vacío." },
    };
  }

  if (!isBcpPagoServicioEmail(rawBody)) {
    return {
      ok: false,
      error: {
        code: "NOT_A_MATCH",
        message:
          "El correo no contiene ninguna frase de pago de servicios del BCP " +
          `(esperada alguna de: ${PAYMENT_MARKERS.join(", ")}).`,
      },
    };
  }

  const body = toNormalizedBody(rawBody);

  const amount = parseAmount(read(body, ["Monto total", "Total pagado"]));
  const transactionAt = parseSpanishDateTime(read(body, ["Fecha y hora", "Fecha"]));
  const operationNumber = normalizeOperationNumber(
    read(body, ["Número de operación", "Nro. de operación", "N° de operación"]),
  );

  const missingFields = REQUIRED_FIELDS.filter((field) => {
    if (field === "amount") return amount === null;
    if (field === "transactionAt") return transactionAt === null;
    return operationNumber === null;
  });

  if (missingFields.length > 0 || !amount || !transactionAt || !operationNumber) {
    return {
      ok: false,
      error: {
        code: "MISSING_FIELDS",
        message:
          "No se pudieron extraer los campos obligatorios del pago de servicios: " +
          `${missingFields.join(", ")}.`,
        missingFields: [...missingFields],
      },
    };
  }

  return {
    ok: true,
    data: {
      bank: "BCP",
      operationType: read(body, ["Operación realizada"]) ?? "Pago de servicios",
      transactionAt,
      amount: amount.amount,
      currency: amount.currency,
      merchant: read(body, ["Empresa"]) ?? "DESCONOCIDO",
      // El número va en el renglón de debajo de «Cuenta de origen».
      cardLast4: findMaskedDigitsAfterLabel(body, ["Cuenta de origen", "Cuenta cargo"]),
      operationNumber,
      comment: buildComment(body),
      source: "GMAIL_BCP",
    },
  };
}

/**
 * Lee un campo, venga donde venga.
 *
 * Primero en negrita —el formato real— y, si no, por etiqueta al principio de
 * línea. Mantener las dos vías cuesta una línea y cubre que el banco vuelva a
 * cambiar la maquetación, que ya lo ha hecho una vez.
 */
function read(body: NormalizedBody, labels: string[]): string | null {
  return findEmphasizedValue(body, labels) ?? findValueByLabel(body, labels);
}

/**
 * Qué se pagó exactamente, para el comentario.
 *
 * `Empresa` no distingue dos recibos de la misma compañía: dos pagos a ENTEL en
 * el mismo minuto se verían idénticos salvo por el importe. El servicio y el
 * código de usuario —el número de línea, en la práctica— sí los separan.
 *
 * `Servicio` se busca en negrita a propósito: la etiqueta vecina «Titular del
 * servicio» contiene el nombre de otra persona, y una búsqueda floja las
 * confundiría.
 */
function buildComment(body: NormalizedBody): string | null {
  const partes = [
    findEmphasizedValue(body, ["Servicio"]),
    findEmphasizedValue(body, ["Código de usuario"]),
  ].filter((parte): parte is string => Boolean(parte && parte.length > 0));

  return partes.length > 0 ? partes.join(" · ") : null;
}

/** Deja el número de operación en solo dígitos; `null` si no queda ninguno. */
function normalizeOperationNumber(input: string | null): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}
