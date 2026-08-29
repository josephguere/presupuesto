/**
 * Utilidades compartidas por todos los parsers de correos bancarios.
 *
 * Aquí vive lo que NO depende del banco: limpieza de texto, lectura de valores
 * por etiqueta, montos con separadores mixtos y fechas en español. Cuando
 * añadamos Interbank o BBVA, reutilizarán este módulo tal cual.
 */

/** Perú (America/Lima) es UTC−05:00 todo el año: no aplica horario de verano. */
export const LIMA_UTC_OFFSET = "-05:00";

const MONTHS_ES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9, // variante frecuente en Perú
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

/** Marcas diacríticas Unicode (los acentos que deja NFD al descomponer). */
const COMBINING_MARKS = /[\u0300-\u036F]/g;

/** Espacios "raros": no separable, fino, de puntuación, ideográfico... */
const EXOTIC_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;

/** Caracteres de ancho cero y BOM: invisibles, pero rompen los regex. */
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

/**
 * Quita las tildes y pasa a minúsculas.
 *
 * Se usa solo para COMPARAR (etiquetas, meses, marcadores). Los valores que
 * acaban en base de datos conservan sus tildes.
 */
export function deaccent(input: string): string {
  return input.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

/**
 * Deja el cuerpo del correo en una forma predecible.
 *
 * Los correos del banco llegan como HTML convertido a texto plano, lo que trae
 * espacios no separables, caracteres invisibles, indentación heredada de las
 * tablas y rachas de líneas vacías. Todo eso se normaliza antes de leer nada.
 */
export function normalizeEmailBody(raw: string): string {
  return (
    raw
      // Saltos de línea de Windows y Mac clásico → \n
      .replace(/\r\n?/g, "\n")
      .replace(EXOTIC_SPACES, " ")
      .replace(ZERO_WIDTH, "")
      // <br> o &nbsp; que sobrevivieron a una conversión HTML→texto floja.
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/&nbsp;/gi, " ")
      // Espacios y tabuladores repetidos → uno solo.
      .replace(/[ \t]+/g, " ")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      // Tres o más saltos seguidos aportan lo mismo que dos.
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Vista del correo lista para leer: las líneas originales y, alineada índice a
 * índice, su versión sin tildes y en minúsculas para buscar etiquetas.
 */
export interface NormalizedBody {
  text: string;
  lines: string[];
  /** `lines` sin tildes y en minúsculas. Misma longitud y mismo orden. */
  keys: string[];
}

export function toNormalizedBody(raw: string): NormalizedBody {
  const text = normalizeEmailBody(raw);
  const lines = text.split("\n");
  return { text, lines, keys: lines.map(deaccent) };
}

/**
 * Busca una etiqueta y devuelve su valor.
 *
 * El banco maquetó los datos en una tabla, así que el valor cae unas veces en
 * la misma línea (`Empresa: YAPE`) y otras en la siguiente:
 *
 *     Empresa:
 *     YAPE
 *
 * Se aceptan las dos formas, con o sin dos puntos, y varias redacciones de la
 * misma etiqueta (`labels` se prueba en orden).
 *
 * @param maxLookahead Líneas en blanco que se toleran antes de rendirse.
 */
export function findValueByLabel(
  body: NormalizedBody,
  labels: string[],
  maxLookahead = 3,
): string | null {
  // Recorremos etiqueta por etiqueta, no línea por línea: `labels` es una lista
  // de preferencia, así que la variante más específica debe ganar aunque
  // aparezca más abajo en el correo que una genérica.
  for (const label of labels) {
    const needle = deaccent(label);

    for (let i = 0; i < body.keys.length; i += 1) {
      if (!body.keys[i].startsWith(needle)) continue;

      const rest = body.lines[i].slice(needle.length).trimStart();

      // La etiqueta tiene que TERMINAR aquí. Solo tres formas cuentan:
      //
      //   "Empresa:"        dos puntos            → valor en esta línea o la siguiente
      //   "Empresa"         nada más en la línea  → valor en la siguiente
      //   "Empresa *YAPE*"  valor en negrita      → así llega de verdad el BCP
      //
      // Sin esta comprobación, la etiqueta "Tarjeta de Débito" casaría con la
      // frase de apertura "Tarjeta de Débito BCP en YAPE." y devolvería basura.
      // Ojo: NO se acepta "etiqueta valor" separados por un simple espacio,
      // justamente porque reabriría esa puerta.
      if (rest.length > 0 && !rest.startsWith(":") && !rest.startsWith("*")) continue;

      // ¿El valor viene en la misma línea?
      const inline = stripEmphasis(rest.replace(/^:\s*/, ""));
      if (inline.length > 0) return inline;

      // Si no, es la siguiente línea con contenido.
      for (let j = i + 1; j <= i + maxLookahead && j < body.lines.length; j += 1) {
        const candidate = stripEmphasis(body.lines[j]);
        if (candidate.length > 0) return candidate;
      }
    }
  }

  return null;
}

/**
 * Quita el énfasis `*...*` con el que Gmail representa el `<b>` del HTML.
 *
 * Solo se elimina el par EXTERIOR. Hay comercios cuyo nombre lleva asteriscos
 * dentro —`DLC*helphbomaxcom` es un caso real— y perderlos cambiaría el dato.
 */
export function stripEmphasis(value: string): string {
  const trimmed = value.trim();
  // Sin el flag `s`: en este punto el valor es siempre de una sola línea.
  const emphasized = trimmed.match(/^\*(.+)\*$/);
  return emphasized ? emphasized[1].trim() : trimmed;
}

/** Un importe con su moneda. */
export interface ParsedAmount {
  amount: number;
  currency: "PEN" | "USD";
}

/**
 * Interpreta un importe escrito por humanos.
 *
 * El reto es que `1,250.50` y `1.250,50` son el mismo número con convenciones
 * opuestas, mientras que `1,250` es mil doscientos cincuenta y no uno coma dos.
 * La regla que lo resuelve: el ÚLTIMO separador es decimal solo si le siguen una
 * o dos cifras; en cualquier otro caso todos los separadores son de millar.
 *
 * Soporta `S/ 20.00`, `S/ 20,00`, `S/ 1,250.50`, `S/ 1.250,50`, `S/. 20.00`,
 * `US$ 30.00` y `20.00 PEN`.
 *
 * @returns `null` si no hay un importe positivo reconocible.
 */
export function parseAmount(input: string | null | undefined): ParsedAmount | null {
  if (!input) return null;

  const normalized = normalizeEmailBody(input);
  const currency: "PEN" | "USD" = /us\$|usd|d[oó]lar/i.test(normalized) ? "USD" : "PEN";

  // Primera secuencia numérica: signo opcional, dígitos y separadores. El signo
  // entra a propósito para que un importe negativo caiga en la guarda de abajo
  // en lugar de colarse como positivo.
  const match = normalized.match(/-?\d[\d.,]*/);
  if (!match) return null;

  // Un separador final sin cifras detrás ("20.") no forma parte del número.
  const cleaned = match[0].replace(/[.,]+$/, "");
  if (!/\d/.test(cleaned)) return null;

  const lastSeparator = Math.max(cleaned.lastIndexOf(","), cleaned.lastIndexOf("."));

  let normalizedNumber: string;
  if (lastSeparator === -1) {
    normalizedNumber = cleaned;
  } else {
    const decimals = cleaned.length - lastSeparator - 1;
    if (decimals === 1 || decimals === 2) {
      const integerPart = cleaned.slice(0, lastSeparator).replace(/[.,]/g, "");
      const fractionPart = cleaned.slice(lastSeparator + 1);
      normalizedNumber = `${integerPart || "0"}.${fractionPart}`;
    } else {
      // Grupos de 3 cifras: todos los separadores son de millar.
      normalizedNumber = cleaned.replace(/[.,]/g, "");
    }
  }

  const amount = Number(normalizedNumber);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  // NUMERIC(12,2): redondeamos aquí para que el número validado sea exactamente
  // el que se guarda.
  return { amount: Math.round(amount * 100) / 100, currency };
}

/**
 * Convierte una fecha en español a ISO-8601 con el offset de Lima.
 *
 * Entrada:  `26 de agosto de 2026 - 06:28 PM`
 * Salida:   `2026-08-26T18:28:00-05:00`
 *
 * Tolera `p. m.` / `p.m.` / `PM`, formato 24 h sin meridiano, segundos
 * opcionales y varios separadores entre fecha y hora.
 *
 * @returns `null` si no hay una fecha válida.
 */
export function parseSpanishDateTime(input: string | null | undefined): string | null {
  if (!input) return null;

  const haystack = deaccent(normalizeEmailBody(input));

  const match = haystack.match(
    /(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})(?:\s*[-–—,/]\s*|\s+(?:a\s+las\s+)?|\s*)(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/,
  );
  if (!match) return null;

  const [, dayRaw, monthName, yearRaw, hourRaw, minuteRaw, secondRaw, meridiemRaw] = match;

  const month = MONTHS_ES[monthName];
  if (!month) return null;

  const day = Number(dayRaw);
  const year = Number(yearRaw);
  let hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = secondRaw ? Number(secondRaw) : 0;

  if (meridiemRaw) {
    const isPm = meridiemRaw.replace(/[\s.]/g, "").startsWith("p");
    if (hour < 1 || hour > 12) return null; // "13:00 PM" no existe
    if (isPm && hour !== 12) hour += 12;
    if (!isPm && hour === 12) hour = 0; // 12:30 AM = 00:30
  }

  if (day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  if (year < 2000 || year > 2100) return null;

  // Descarta días que no existen en ese mes (31 de febrero). Ojo: no vale
  // construir la fecha y comprobarla, porque JavaScript desborda en silencio
  // — el 31 de febrero se convierte en el 3 de marzo sin avisar.
  if (day > daysInMonth(year, month)) return null;

  return (
    `${pad(year, 4)}-${pad(month)}-${pad(day)}` +
    `T${pad(hour)}:${pad(minute)}:${pad(second)}${LIMA_UTC_OFFSET}`
  );
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/** Días reales del mes, años bisiestos incluidos. Día 0 = último del anterior. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Extrae los últimos 4 dígitos de algo como `************3400`. */
export function extractLast4(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}
