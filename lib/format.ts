/**
 * Formato para la interfaz. Locale `es-PE`, zona horaria `America/Lima`.
 *
 * La zona horaria es explícita en TODOS los formatos de fecha. Vercel ejecuta en
 * UTC, así que sin ella un consumo de las 18:28 en Lima (23:28 UTC) se
 * mostraría con la fecha correcta por poco... hasta que uno a las 20:00 apareciese
 * con la fecha del día siguiente.
 */

export const LIMA_TIME_ZONE = "America/Lima";
const LOCALE = "es-PE";

/** Los `Intl.*Format` son caros de construir: se crean una vez y se reutilizan. */
const currencyFormatters = new Map<string, Intl.NumberFormat>();

/**
 * Importe con símbolo de moneda: `S/ 1,250.50`.
 *
 * @param currency Código ISO-4217. Por defecto `PEN`.
 */
export function formatCurrency(amount: number, currency = "PEN"): string {
  const code = currency?.toUpperCase() || "PEN";

  let formatter = currencyFormatters.get(code);
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    currencyFormatters.set(code, formatter);
  }

  return formatter.format(amount);
}

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: LIMA_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: LIMA_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  // 24 horas. El correo dice "11:20 PM" y aqui se lee "23:20", que es lo que
  // hay guardado y no admite ambiguedad al ojear una lista de movimientos.
  hour12: false,
});

/** Fecha corta en hora de Lima: `26 Ago 2026`. */
export function formatTransactionDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  // `es-PE` devuelve "26 ago. 2026". Quitamos el punto de la abreviatura y
  // capitalizamos el mes para que la tabla quede alineada: "26 Ago 2026".
  return dateFormatter
    .format(date)
    .replace(/\./g, "")
    .replace(/\p{L}+/gu, (word) => word[0].toUpperCase() + word.slice(1));
}

/** Hora en Lima, formato 24 h: `23:20`. */
export function formatTransactionTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : timeFormatter.format(date);
}

/**
 * Los doce meses en castellano.
 *
 * Se exporta para que `lib/period.ts` etiquete sus períodos con estos mismos
 * nombres. Duplicarlos allí crearía una segunda lista que puede discrepar.
 */
export const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

/** `2026-08` → `Agosto 2026`. */
export function formatMonthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const name = MONTH_NAMES[monthNumber - 1];
  return name ? `${name} ${year}` : month;
}

/** `3400` → `****3400`. */
export function maskCard(last4: string | null): string {
  return last4 ? `****${last4}` : "—";
}

/* -------------------------------------------------------------------------- */
/* Valores para <input type="date"> y <input type="time">                      */
/* -------------------------------------------------------------------------- */

const dateInputFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: LIMA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * ISO con offset → `YYYY-MM-DD` **en hora de Lima**.
 *
 * Sin fijar la zona, un consumo de las 23:20 en Lima se editaría con la fecha
 * del día siguiente, porque el servidor de Vercel corre en UTC.
 */
export function toDateInputValue(iso: string | null): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return dateInputFormatter.format(new Date());
  return dateInputFormatter.format(date);
}

/** ISO con offset → `HH:MM` en hora de Lima, 24 horas. */
export function toTimeInputValue(iso: string | null): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return timeFormatter.format(new Date());
  return timeFormatter.format(date);
}
