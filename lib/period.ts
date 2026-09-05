import { MONTH_NAMES } from "@/lib/format";

/**
 * Períodos en hora de Lima: «ayer», «este mes», «agosto», «últimos 30 días».
 *
 * MÓDULO PURO. No importa Supabase, ni zod, ni el SDK de Gemini, y el instante
 * actual entra siempre por parámetro. Eso es lo que hace que sus pruebas no
 * caduquen mañana: no hay ningún `new Date()` sin argumentos que las convierta
 * en una bomba de relojería.
 *
 * QUIÉN RESUELVE QUÉ. El modelo NO calcula fechas: devuelve una etiqueta de las
 * trece de `PeriodKind` («mes_anterior», «ultimos_dias»…) y es este módulo quien
 * la convierte en días concretos. Dejar que el modelo escribiera `dateFrom` y
 * `dateTo` significaría confiarle saber qué día es hoy —que no lo sabe, salvo
 * que se lo digamos— y la aritmética de meses de 28, 30 y 31 días. Un error suyo
 * ahí daría una respuesta con números correctos sobre el período equivocado, que
 * es la peor clase de error: la que no se nota.
 *
 * LA ARITMÉTICA VA SOBRE CADENAS `YYYY-MM-DD`, anclada al mediodía UTC. Sumar
 * días con `setDate` sobre un `Date` usa los getters de la zona del PROCESO, así
 * que el mismo código da resultados distintos en Vercel (UTC) y en un portátil
 * en Lima. Con el ancla a las 12:00 UTC ningún desplazamiento de ±14 horas puede
 * cruzar la medianoche, y el resultado es el mismo se ejecute donde se ejecute.
 *
 * Perú es UTC−05:00 todo el año: no hay horario de verano y por eso el offset
 * puede escribirse literal, como ya hace `lib/transactions.ts`.
 *
 * Este módulo devuelve fechas CIVILES inclusivas por ambos extremos, que es el
 * contrato que ya publica `TransactionFilters`. La conversión a instantes con
 * offset `-05:00` se queda dentro de `lib/transactions.ts`, en un solo sitio.
 */

/** Perú: la semana empieza el lunes, como en el resto de Hispanoamérica. */
export const WEEK_STARTS_ON = 1;

/** Tope de «últimos N días». Más allá, el período deja de ser una ventana. */
const MAX_LAST_DAYS = 365;

/** Zona horaria del proyecto. Se repite aquí para no importar `lib/format` entero. */
const LIMA_OFFSET_HOURS = -5;

export type PeriodKind =
  | "hoy"
  | "ayer"
  | "esta_semana"
  | "semana_anterior"
  | "este_mes"
  | "mes_anterior"
  | "este_ano"
  | "ano_anterior"
  | "ultimos_dias"
  | "mes"
  | "ano"
  | "rango"
  | "todo";

/**
 * Lo que el modelo puede pedir.
 *
 * Las trece etiquetas cubren todo lo que el usuario enumeró y algo más. `rango`
 * es la única que lleva fechas explícitas, y se reserva para cuando el usuario
 * las dice él («del 3 al 12 de agosto»).
 */
export type PeriodSpec =
  | {
      kind:
        | "hoy"
        | "ayer"
        | "esta_semana"
        | "semana_anterior"
        | "este_mes"
        | "mes_anterior"
        | "este_ano"
        | "ano_anterior"
        | "todo";
    }
  | { kind: "ultimos_dias"; days: number }
  | { kind: "mes"; month: number; year?: number }
  | { kind: "ano"; year: number }
  | { kind: "rango"; from: string; to: string };

/**
 * Sin período, el mes en curso.
 *
 * Es el mismo criterio que aplican Resumen y Movimientos con `withDefaultMonth`,
 * así que «¿cuánto gasté?» a secas responde por el mismo período que enseña la
 * pantalla que el usuario tiene detrás del chat.
 */
export const DEFAULT_PERIOD: PeriodSpec = { kind: "este_mes" };

export interface ResolvedPeriod {
  kind: PeriodKind;
  /** `YYYY-MM-DD` inclusivo. Ausente solo en `todo`. */
  from?: string;
  /** `YYYY-MM-DD` inclusivo. Ausente solo en `todo`. */
  to?: string;
  /** Legible: «del 1 al 30 de septiembre de 2026». */
  label: string;
  /**
   * El período empieza después de hoy.
   *
   * No puede haber movimientos, así que la ruta corta aquí y se ahorra la
   * consulta y la segunda llamada al modelo.
   */
  isFuture: boolean;
  /**
   * Conviene decir qué período se usó.
   *
   * Verdadero cuando hubo inferencia —el usuario no dijo período, o dijo «agosto»
   * sin año—. Falso cuando pidió exactamente eso y repetírselo sobra.
   */
  announce: boolean;
}

/* -------------------------------------------------------------------------- */
/* Aritmética de fechas civiles                                                */
/* -------------------------------------------------------------------------- */

const pad = (value: number) => String(value).padStart(2, "0");

/** `YYYY-MM-DD` con forma válida **y fecha real**: rechaza `2026-02-31`. */
export function isRealDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;

  return day <= daysInMonth(year, month);
}

/** Días de un mes, contando los bisiestos. `month` va de 1 a 12. */
export function daysInMonth(year: number, month: number): number {
  // El día 0 del mes siguiente es el último del mes pedido.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Suma (o resta) días a una fecha civil.
 *
 * Ancla al mediodía UTC a propósito: así ningún desplazamiento horario puede
 * hacer que el resultado caiga en el día anterior o el siguiente.
 */
export function addDays(date: string, days: number): string {
  const anchor = new Date(`${date}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return toCivil(anchor);
}

/** Un `Date` anclado en UTC → `YYYY-MM-DD`. */
function toCivil(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Día de la semana en hora civil: 0 domingo … 6 sábado. */
function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/**
 * Qué día es HOY en Lima.
 *
 * Vercel corre en UTC, así que a partir de las 19:00 de Lima el `new Date()` del
 * servidor ya dice mañana. Se desplaza el instante cinco horas y se lee en UTC,
 * que es exactamente la hora civil peruana.
 */
export function getLimaToday(now: Date = new Date()): string {
  return toCivil(new Date(now.getTime() + LIMA_OFFSET_HOURS * 3_600_000));
}

/* -------------------------------------------------------------------------- */
/* Resolución                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Convierte una etiqueta de período en días concretos.
 *
 * Nunca lanza: un `spec` incoherente —un mes 13, un rango invertido— se corrige
 * o se degrada al mes en curso. Quien construye el `spec` es el modelo, y una
 * excepción aquí convertiría una alucinación suya en un error 500.
 */
export function resolvePeriod(spec: PeriodSpec, now: Date = new Date()): ResolvedPeriod {
  const today = getLimaToday(now);
  const range = toRange(spec, today);

  return {
    kind: spec.kind,
    from: range.from,
    to: range.to,
    label: buildLabel(spec, range, today),
    // Solo importa que EMPIECE en el futuro. Un período que empezó ayer y acaba
    // dentro de una semana sí tiene movimientos que enseñar.
    isFuture: range.from !== undefined && range.from > today,
    announce: range.announce,
  };
}

interface Range {
  from?: string;
  to?: string;
  announce: boolean;
}

function toRange(spec: PeriodSpec, today: string): Range {
  const [year, month] = today.split("-").map(Number);

  switch (spec.kind) {
    case "hoy":
      return { from: today, to: today, announce: false };

    case "ayer": {
      const yesterday = addDays(today, -1);
      return { from: yesterday, to: yesterday, announce: false };
    }

    case "esta_semana":
    case "semana_anterior": {
      // Lunes de la semana en curso. `weekday` da 0 para domingo, que en una
      // semana que empieza en lunes es el SÉPTIMO día, no el primero.
      const offset = (weekday(today) - WEEK_STARTS_ON + 7) % 7;
      const monday = addDays(today, -offset);
      const start = spec.kind === "esta_semana" ? monday : addDays(monday, -7);

      return {
        from: start,
        // La semana en curso se corta HOY: los días que aún no han pasado no
        // tienen movimientos y alargar el rango solo confunde la etiqueta.
        to: spec.kind === "esta_semana" ? today : addDays(start, 6),
        announce: true,
      };
    }

    case "este_mes":
      return monthRange(year, month, today, false);

    case "mes_anterior": {
      const previousMonth = month === 1 ? 12 : month - 1;
      const previousYear = month === 1 ? year - 1 : year;
      return monthRange(previousYear, previousMonth, today, false);
    }

    case "este_ano":
      return { from: `${year}-01-01`, to: today, announce: true };

    case "ano_anterior":
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31`, announce: true };

    case "ultimos_dias": {
      const days = clamp(Math.trunc(spec.days), 1, MAX_LAST_DAYS);
      // «Últimos 30 días» incluye hoy: son 30 días, no 31.
      return { from: addDays(today, -(days - 1)), to: today, announce: true };
    }

    case "mes": {
      const wanted = clamp(Math.trunc(spec.month), 1, 12);
      // Sin año, el más reciente que YA ha ocurrido: en septiembre de 2026,
      // «diciembre» es el de 2025, porque el de 2026 no ha pasado todavía.
      const inferred = spec.year ?? (wanted <= month ? year : year - 1);
      const wantedYear = clamp(Math.trunc(inferred), 1970, 9999);

      return monthRange(wantedYear, wanted, today, spec.year === undefined);
    }

    case "ano": {
      const wanted = clamp(Math.trunc(spec.year), 1970, 9999);
      return { from: `${wanted}-01-01`, to: `${wanted}-12-31`, announce: true };
    }

    case "rango": {
      // Un extremo ilegible degrada al mes en curso: es preferible responder por
      // un período que el usuario ve escrito que por uno inventado a medias.
      if (!isRealDate(spec.from) || !isRealDate(spec.to)) {
        return monthRange(year, month, today, true);
      }

      // Invertido, se endereza. Es un desliz del modelo, no una pregunta distinta.
      const [from, to] =
        spec.from <= spec.to ? [spec.from, spec.to] : [spec.to, spec.from];

      return { from, to, announce: false };
    }

    case "todo":
      // Sin extremos: `getTransactions` no aplicará filtro de fecha.
      return { announce: true };
  }
}

/**
 * Un mes natural, cortado por hoy si es el mes en curso.
 *
 * Que el mes actual acabe hoy y no el día 30 importa para la etiqueta: decir «del
 * 1 al 30 de septiembre» un día 5 sugiere que se miraron días que aún no existen.
 */
function monthRange(year: number, month: number, today: string, announce: boolean): Range {
  const first = `${year}-${pad(month)}-01`;
  const last = `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;

  return { from: first, to: last > today ? today : last, announce };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/* -------------------------------------------------------------------------- */
/* Etiquetas                                                                   */
/* -------------------------------------------------------------------------- */

/** `2026-09-05` → `5 de septiembre de 2026`. */
export function formatDay(date: string): string {
  if (!isRealDate(date)) return date;

  const [year, month, day] = date.split("-").map(Number);
  return `${day} de ${MONTH_NAMES[month - 1].toLowerCase()} de ${year}`;
}

/** El rango, en la forma más corta que siga siendo inequívoca. */
export function formatRangeLabel(from: string | undefined, to: string | undefined): string {
  if (!from && !to) return "todo el historial";
  if (from && !to) return `desde el ${formatDay(from)}`;
  if (!from && to) return `hasta el ${formatDay(to)}`;
  if (from === to) return `el ${formatDay(from!)}`;

  const [fromYear, fromMonth] = from!.split("-");
  const [toYear, toMonth] = to!.split("-");

  // Dentro del mismo mes basta con nombrarlo una vez: «del 1 al 30 de septiembre
  // de 2026» en lugar de repetir mes y año en los dos extremos.
  if (fromYear === toYear && fromMonth === toMonth) {
    const day = Number(from!.slice(8));
    return `del ${day} al ${formatDay(to!)}`;
  }

  return `del ${formatDay(from!)} al ${formatDay(to!)}`;
}

/**
 * La etiqueta del período, con el nombre coloquial cuando lo tiene.
 *
 * «septiembre de 2026 (mes en curso)» se lee mejor que «del 1 al 5 de septiembre
 * de 2026», y a la vez el paréntesis avisa de que el mes no está completo.
 */
function buildLabel(spec: PeriodSpec, range: Range, today: string): string {
  switch (spec.kind) {
    case "hoy":
      return `hoy, ${formatDay(today)}`;

    case "ayer":
      return `ayer, ${formatDay(range.from!)}`;

    case "esta_semana":
      return `esta semana (${formatRangeLabel(range.from, range.to)})`;

    case "semana_anterior":
      return `la semana pasada (${formatRangeLabel(range.from, range.to)})`;

    case "este_mes":
      return `${monthLabel(range.from!)} (mes en curso, hasta el día ${Number(
        range.to!.slice(8),
      )})`;

    case "mes_anterior":
      return `${monthLabel(range.from!)} (mes anterior)`;

    case "este_ano":
      return `${range.from!.slice(0, 4)} (año en curso, ${formatRangeLabel(
        range.from,
        range.to,
      )})`;

    case "ano_anterior":
    case "ano":
      return range.from!.slice(0, 4);

    case "ultimos_dias":
      return `los últimos ${clamp(Math.trunc(spec.days), 1, MAX_LAST_DAYS)} días (${formatRangeLabel(
        range.from,
        range.to,
      )})`;

    case "mes": {
      // Un mes que sigue abierto se marca, igual que «este_mes»: el usuario que
      // pregunta por «septiembre» estando en septiembre debe saber que faltan días.
      const incompleto = range.to! < lastDayOf(range.from!);
      return incompleto
        ? `${monthLabel(range.from!)} (hasta el día ${Number(range.to!.slice(8))})`
        : monthLabel(range.from!);
    }

    case "rango":
      return formatRangeLabel(range.from, range.to);

    case "todo":
      return "todo el historial";
  }
}

/** `2026-09-01` → `septiembre de 2026`. */
function monthLabel(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return `${MONTH_NAMES[month - 1].toLowerCase()} de ${year}`;
}

/** Último día del mes al que pertenece la fecha. */
function lastDayOf(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
}

/* -------------------------------------------------------------------------- */
/* Comparación                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * El período inmediatamente anterior, para `period_comparison`.
 *
 * Existe porque «¿gasté más que el mes pasado?» es la pregunta natural y no debe
 * fallar si el modelo omite el segundo período. Devuelve `null` solo cuando no
 * hay anterior posible —`todo` no tiene uno—, y entonces la intención se rechaza.
 *
 * Para las etiquetas relativas se devuelve la etiqueta hermana, no un rango
 * calculado: así «esta semana» compara con «la semana pasada» y la respuesta
 * puede nombrar los dos períodos en cristiano.
 */
export function previousPeriod(spec: PeriodSpec, now: Date = new Date()): PeriodSpec | null {
  const today = getLimaToday(now);

  switch (spec.kind) {
    case "hoy":
      return { kind: "ayer" };

    case "ayer": {
      const anteayer = addDays(today, -2);
      return { kind: "rango", from: anteayer, to: anteayer };
    }

    case "esta_semana":
      return { kind: "semana_anterior" };

    case "semana_anterior": {
      const offset = (weekday(today) - WEEK_STARTS_ON + 7) % 7;
      const start = addDays(addDays(today, -offset), -14);
      return { kind: "rango", from: start, to: addDays(start, 6) };
    }

    case "este_mes":
      return { kind: "mes_anterior" };

    case "mes_anterior": {
      const [year, month] = today.split("-").map(Number);
      // Dos meses atrás desde el mes en curso.
      const target = month - 2;
      return target >= 1
        ? { kind: "mes", month: target, year }
        : { kind: "mes", month: target + 12, year: year - 1 };
    }

    case "este_ano":
      return { kind: "ano_anterior" };

    case "ano_anterior":
      return { kind: "ano", year: Number(today.slice(0, 4)) - 2 };

    case "mes": {
      const resolved = resolvePeriod(spec, now);
      const [year, month] = resolved.from!.split("-").map(Number);
      return month === 1
        ? { kind: "mes", month: 12, year: year - 1 }
        : { kind: "mes", month: month - 1, year };
    }

    case "ano":
      return { kind: "ano", year: Math.trunc(spec.year) - 1 };

    case "ultimos_dias": {
      const days = clamp(Math.trunc(spec.days), 1, MAX_LAST_DAYS);
      // La ventana inmediatamente anterior, de la misma longitud.
      const end = addDays(today, -days);
      return { kind: "rango", from: addDays(end, -(days - 1)), to: end };
    }

    case "rango": {
      if (!isRealDate(spec.from) || !isRealDate(spec.to)) return null;

      const [from, to] = spec.from <= spec.to ? [spec.from, spec.to] : [spec.to, spec.from];
      const length = daysBetween(from, to) + 1;
      const end = addDays(from, -1);

      return { kind: "rango", from: addDays(end, -(length - 1)), to: end };
    }

    case "todo":
      // No hay nada anterior a todo el historial.
      return null;
  }
}

/** Días enteros entre dos fechas civiles. Ambas ancladas al mediodía UTC. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/* -------------------------------------------------------------------------- */
/* Salida hacia la capa de datos                                               */
/* -------------------------------------------------------------------------- */

/**
 * El período, como lo esperan los filtros de `lib/transactions.ts`.
 *
 * Se pasan `from`/`to` y NUNCA `month`, aunque el período sea un mes natural: el
 * mes en curso está cortado por hoy, y `month` lo interpretaría entero. Un solo
 * camino de traducción evita que ambos discrepen.
 */
export function toTransactionFilters(period: ResolvedPeriod): { from?: string; to?: string } {
  const filters: { from?: string; to?: string } = {};

  if (period.from) filters.from = period.from;
  if (period.to) filters.to = period.to;

  return filters;
}
