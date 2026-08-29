import {
  extractLast4,
  findValueByLabel,
  parseAmount,
  parseSpanishDateTime,
  toNormalizedBody,
  deaccent,
  normalizeEmailBody,
  type NormalizedBody,
} from "./normalize";
import type { ParseResult, ParsedTransaction } from "./types";

/**
 * Parser de las notificaciones de consumo del BCP (débito y crédito).
 *
 * Un solo parser para los dos productos porque los correos son idénticos salvo
 * la palabra «Débito»/«Crédito»; el producto concreto queda registrado en
 * `operationType`. Duplicar el módulo por tarjeta sería copiar doscientas líneas
 * para cambiar una palabra.
 *
 * Se manejan DOS disposiciones, porque el banco usa una y el material de
 * referencia describía la otra:
 *
 *   A) La real, tal como Gmail entrega el correo del BCP. Etiqueta y valor en el
 *      mismo renglón, sin dos puntos, con el valor en negrita —que en texto
 *      plano queda entre asteriscos:
 *
 *          Realizaste un consumo de *S/ 35.90* con tu *Tarjeta de Crédito BCP* en
 *          *DLC*helphbomaxcom.*
 *
 *          Total del consumo *S/ 35.90*
 *          Operación realizada *Consumo Tarjeta de Crédito*
 *          Fecha y hora *28 de agosto de 2026 - 11:20 PM*
 *          Número de Tarjeta de Crédito *************2437*
 *          Empresa *DLC*helphbomaxcom*
 *          Número de operación *0000414074*
 *
 *   B) Con dos puntos y el valor en la línea siguiente:
 *
 *          Total del consumo:
 *          S/ 20.00
 *
 * Cada campo obligatorio tiene además un regex de respaldo sobre el cuerpo
 * entero. Es deliberado: cuando el banco cambió el formato, los campos con
 * respaldo siguieron funcionando y el único que no lo tenía fue el que rompió
 * la ingesta.
 *
 * El módulo es puro: entra texto, sale un resultado tipado. No conoce HTTP ni
 * la base de datos, por lo que se puede probar solo (`npm test`).
 */

/**
 * Frases que identifican una notificación de consumo del BCP.
 *
 * Se comparan sin tildes ni mayúsculas. Deliberadamente NO dependemos del
 * asunto: todavía no conocemos el asunto exacto de todos los correos del banco,
 * y el cuerpo es mucho más estable.
 */
const CONSUMPTION_MARKERS = ["realizaste un consumo", "realizaste una compra"];

/** Campos sin los cuales un movimiento no sirve para nada. */
const REQUIRED_FIELDS = ["amount", "transactionAt", "operationNumber"] as const;

/**
 * ¿Este cuerpo parece una notificación de consumo del BCP?
 *
 * Se usa como primer filtro barato antes de intentar extraer nada. El endpoint
 * valida además el remitente; ambas comprobaciones son independientes a
 * propósito, para poder endurecer una sin tocar la otra.
 */
export function isBcpConsumoEmail(rawBody: string): boolean {
  // Normalizamos antes de comparar: si no, un `&nbsp;` entre palabras bastaría
  // para que no reconociéramos un correo perfectamente válido.
  const haystack = deaccent(normalizeEmailBody(rawBody));
  return CONSUMPTION_MARKERS.some((marker) => haystack.includes(marker));
}

/**
 * Extrae la transacción de un correo de consumo con débito del BCP.
 *
 * Nunca lanza: un correo con formato inesperado devuelve `{ ok: false }` con el
 * motivo. Quien llama decide qué hacer, y el correo crudo se conserva igual.
 */
export function parseBcpConsumoEmail(rawBody: string): ParseResult<ParsedTransaction> {
  if (typeof rawBody !== "string" || rawBody.trim().length === 0) {
    return {
      ok: false,
      error: { code: "NOT_A_MATCH", message: "El cuerpo del correo está vacío." },
    };
  }

  if (!isBcpConsumoEmail(rawBody)) {
    return {
      ok: false,
      error: {
        code: "NOT_A_MATCH",
        message:
          "El correo no contiene ninguna frase de notificación de consumo del BCP " +
          `(esperada alguna de: ${CONSUMPTION_MARKERS.join(", ")}).`,
      },
    };
  }

  const body = toNormalizedBody(rawBody);

  const amount = parseAmount(
    findValueByLabel(body, ["Total del consumo", "Monto del consumo", "Total"]) ??
      // Respaldo: el importe también aparece en la frase de apertura.
      matchFirst(body.text, /realizaste (?:un consumo|una compra) de\s+([^\n]+?)\s+con/i),
  );

  const transactionAt = parseSpanishDateTime(
    findValueByLabel(body, ["Fecha y hora", "Fecha"]) ??
      // Respaldo: buscar la fecha en cualquier parte del cuerpo.
      matchFirst(body.text, /(\d{1,2}\s+de\s+[A-Za-zÁÉÍÓÚáéíóú]+\s+de\s+\d{4}[^\n]*)/),
  );

  const operationNumber = normalizeOperationNumber(
    findValueByLabel(body, [
      "Número de operación",
      "Nro. de operación",
      "N° de operación",
      "Código de operación",
    ]) ??
      // Respaldo: la etiqueta seguida del número en cualquier disposición.
      matchFirst(body.text, /n[uú]mero de operaci[oó]n[^\d\n]{0,12}(\d{3,})/i),
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
        code: missingFields.length > 0 ? "MISSING_FIELDS" : "INVALID_FORMAT",
        message:
          "No se pudieron extraer los campos obligatorios del correo BCP: " +
          `${missingFields.join(", ")}.`,
        missingFields: [...missingFields],
      },
    };
  }

  return {
    ok: true,
    data: {
      bank: "BCP",
      operationType:
        findValueByLabel(body, ["Operación realizada", "Tipo de operación"]) ??
        // Sin etiqueta no sabemos el producto: no lo inventamos.
        "Consumo",
      transactionAt,
      amount: amount.amount,
      currency: amount.currency,
      merchant: extractMerchant(body),
      cardLast4: extractLast4(
        findValueByLabel(body, [
          "Número de Tarjeta de Crédito",
          "Número de Tarjeta de Débito",
          "Número de tarjeta",
          "Tarjeta de Crédito",
          "Tarjeta de Débito",
          "Tarjeta",
        ]) ??
          // Respaldo: cualquier grupo de dígitos tras una máscara de asteriscos.
          matchFirst(body.text, /\*{4,}\s*(\d{4})\b/),
      ),
      operationNumber,
      source: "GMAIL_BCP",
    },
  };
}

/**
 * Nombre del comercio.
 *
 * La etiqueta `Empresa:` es la fuente principal. Si no está, se recupera del
 * cierre de la frase de apertura: «... con tu Tarjeta de Débito BCP en YAPE.»
 */
function extractMerchant(body: NormalizedBody): string {
  const labelled = findValueByLabel(body, ["Empresa", "Comercio", "Establecimiento"]);
  if (labelled) return labelled.replace(/\.$/, "").trim();

  const fromSentence = matchFirst(
    body.text,
    /realizaste (?:un consumo|una compra)[\s\S]{0,120}?\ben\s+([^\n.]+)/i,
  );
  if (fromSentence) return fromSentence.trim();

  // Preferimos un valor honesto a inventarnos un comercio: el correo crudo
  // queda guardado y siempre se puede reprocesar.
  return "DESCONOCIDO";
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
