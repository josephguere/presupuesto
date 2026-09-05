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
 * Parser de las constancias de transferencia del BCP.
 *
 * FORMATO REAL, tal como lo entrega `getPlainBody()` de Apps Script. Etiqueta y
 * valor en el mismo renglón, con el valor en negrita —asteriscos en texto
 * plano—, y a veces también la etiqueta:
 *
 *     Realizaste una transferencia de *S/ 50.00* desde tu *Cuenta corriente.*
 *     Monto enviado *S/ 50.00*
 *     Comisión *S/ 0.00*
 *     *Total cobrado* *S/ 50.00*
 *     Operación realizada *Transferencia a otros bancos*
 *     Fecha y hora *02 de Septiembre de 2026 - 11:11 PM*
 *     Enviado a *Joseph Abad Guere S.*
 *     **** 7842
 *     Banco destino *Interbank*
 *     Desde *Cuenta corriente*
 *     **** 4035
 *     Número de operación *06042517* <#>
 *
 * DOS DECISIONES QUE NO SON OBVIAS:
 *
 *   · El importe sale de `Total cobrado`, NO de `Monto enviado`. Lo que se va de
 *     tu cuenta incluye la comisión. Hoy es S/ 0.00 y da igual; el día que no lo
 *     sea, `Monto enviado` mentiría por lo bajo. Ojo con esa etiqueta: viene
 *     ella misma en negrita, `*Total cobrado* *S/ 50.00*`.
 *
 *   · HAY DOS CUENTAS en el correo. `**** 7842` es la del destinatario, bajo
 *     «Enviado a», y `**** 4035` la tuya, bajo «Desde». Coger la primera —o
 *     buscar «el primer **** del cuerpo»— guardaría la cuenta ajena como si
 *     fuera la tuya. Por eso se ancla a «Desde» y a nada más.
 *
 * SOLO SALIDAS. El BCP no notifica el dinero que entra, así que todo correo de
 * este tipo es dinero que sale. No hay que deducir ningún signo.
 */

/** Frases que identifican una constancia de transferencia. */
const TRANSFER_MARKERS = ["realizaste una transferencia", "transferencia a otros bancos"];

/** Campos sin los cuales el movimiento no sirve. */
const REQUIRED_FIELDS = ["amount", "transactionAt", "operationNumber"] as const;

/** ¿Este cuerpo parece una constancia de transferencia del BCP? */
export function isBcpTransferenciaEmail(rawBody: string): boolean {
  const haystack = deaccent(normalizeEmailBody(rawBody));
  return TRANSFER_MARKERS.some((marker) => haystack.includes(marker));
}

export function parseBcpTransferenciaEmail(rawBody: string): ParseResult<ParsedTransaction> {
  if (typeof rawBody !== "string" || rawBody.trim().length === 0) {
    return {
      ok: false,
      error: { code: "NOT_A_MATCH", message: "El cuerpo del correo está vacío." },
    };
  }

  if (!isBcpTransferenciaEmail(rawBody)) {
    return {
      ok: false,
      error: {
        code: "NOT_A_MATCH",
        message:
          "El correo no contiene ninguna frase de transferencia del BCP " +
          `(esperada alguna de: ${TRANSFER_MARKERS.join(", ")}).`,
      },
    };
  }

  const body = toNormalizedBody(rawBody);

  const amount = parseAmount(
    // El orden es la regla: primero lo que de verdad se cobró.
    read(body, ["Total cobrado", "Monto enviado", "Monto"]) ??
      // Respaldo: el importe también aparece en la frase de apertura.
      matchFirst(body.text, /realizaste una transferencia de\s+\*?([^*\n]+?)\*?\s+desde/i),
  );

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
          "No se pudieron extraer los campos obligatorios de la transferencia: " +
          `${missingFields.join(", ")}.`,
        missingFields: [...missingFields],
      },
    };
  }

  return {
    ok: true,
    data: {
      bank: "BCP",
      operationType: read(body, ["Operación realizada"]) ?? "Transferencia",
      transactionAt,
      amount: amount.amount,
      currency: amount.currency,
      merchant: buildMerchant(body),
      cardLast4: findMaskedDigitsAfterLabel(body, ["Desde", "Cuenta de origen"]),
      operationNumber,
      comment: read(body, ["Enviado a", "Destinatario"]),
      source: "GMAIL_BCP",
    },
  };
}

/** Lee un campo en negrita y, si no, por etiqueta al principio de línea. */
function read(body: NormalizedBody, labels: string[]): string | null {
  return findEmphasizedValue(body, labels) ?? findValueByLabel(body, labels);
}

/**
 * Qué se ve en la columna «Movimiento».
 *
 * El banco destino, no el nombre del destinatario: al revisar el mes,
 * «Interbank» dice de qué operación se trata, mientras que un nombre propio en
 * la columna principal se lee como si fuera un comercio. La persona va al
 * comentario.
 */
function buildMerchant(body: NormalizedBody): string {
  const banco = read(body, ["Banco destino", "Banco"]);
  if (banco) return `Transferencia a ${banco}`;

  const destinatario = read(body, ["Enviado a", "Destinatario"]);
  return destinatario ? `Transferencia a ${destinatario}` : "Transferencia";
}

/** Deja el número de operación en solo dígitos; `null` si no queda ninguno. */
function normalizeOperationNumber(input: string | null): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/** Primer grupo de captura de un regex, o `null`. */
function matchFirst(haystack: string, pattern: RegExp): string | null {
  const match = haystack.match(pattern);
  return match?.[1]?.trim() ?? null;
}
