import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { describeError, logger } from "@/lib/logger";

/**
 * Tipo de cambio USD → PEN.
 *
 * FUENTE: SUNAT, a través de la API pública de apis.net.pe. Es el tipo de cambio
 * OFICIAL peruano, el mismo que usa contabilidad en el país, y devuelve valores
 * históricos por fecha sin necesitar API key. Para una app de presupuesto en
 * Perú es la fuente correcta; una API genérica de divisas daría el tipo
 * interbancario, que no es el que aplica el banco.
 *
 * Se usa el valor de VENTA: al pagar en dólares con una tarjeta peruana, el
 * banco te vende dólares, así que ese es el lado del tipo de cambio que aplica.
 *
 * POR QUÉ HAY CACHÉ: la API gratuita corta con HTTP 429 tras unas pocas
 * peticiones por minuto. Sin caché, casi todas las conversiones acabarían usando
 * el fallback y el importe sería materialmente incorrecto (3.4 frente a ~3.35
 * real). El tipo de cambio de una fecha pasada no cambia nunca, así que se
 * guarda en `exchange_rates` y se consulta a la API una sola vez por fecha.
 *
 * Si todo falla, se usa `DEFAULT_USD_PEN_RATE` y se registra en el log. La
 * transacción se procesa igualmente: es preferible un importe aproximado y
 * trazable a perder el movimiento.
 */

/**
 * Tipo de cambio de emergencia.
 *
 * Definido UNA sola vez. No repitas este número en ningún otro archivo.
 */
export const DEFAULT_USD_PEN_RATE = 3.4;

/** De dónde salió el número, para poder auditarlo después. */
export type ExchangeRateSource = "API" | "FALLBACK";

export interface ExchangeRate {
  /** Cuántos soles vale un dólar. */
  rate: number;
  source: ExchangeRateSource;
  /** Fecha `YYYY-MM-DD` a la que corresponde el tipo de cambio. */
  date: string;
}

/** Endpoint por defecto. Configurable por si cambia el proveedor. */
const DEFAULT_API_URL = "https://api.apis.net.pe/v1/tipo-cambio-sunat";

/** Nunca dejar una ingesta colgada esperando a un tercero. */
const REQUEST_TIMEOUT_MS = 6_000;

/** Respuesta de SUNAT: `{"origen":"SUNAT","compra":3.34,"venta":3.348,...}` */
interface SunatResponse {
  compra?: number;
  venta?: number;
  moneda?: string;
  fecha?: string;
}

/** `Date` u objeto con fecha → `YYYY-MM-DD` en hora de Lima. */
export function toRateDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);

  // La fecha del tipo de cambio es la del día en Lima, no la del servidor.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Tipo de cambio de una fecha: caché → API → fallback.
 *
 * Nunca lanza. Siempre devuelve un número utilizable.
 */
export async function getUsdToPenRate(date: Date | string): Promise<ExchangeRate> {
  const rateDate = toRateDate(date);

  const cached = await readFromCache(rateDate);
  if (cached !== null) {
    return { rate: cached, source: "API", date: rateDate };
  }

  const fetched = await fetchFromApi(rateDate);
  if (fetched !== null) {
    // Solo se cachean respuestas reales: un fallback no debe fosilizarse.
    await writeToCache(rateDate, fetched);
    return { rate: fetched, source: "API", date: rateDate };
  }

  logger.warn("exchangeRate.fallback", { date: rateDate, rate: DEFAULT_USD_PEN_RATE });
  return { rate: DEFAULT_USD_PEN_RATE, source: "FALLBACK", date: rateDate };
}

/** Convierte a soles y redondea a 2 decimales, como exige `NUMERIC(12,2)`. */
export function convertUsdToPen(amountUsd: number, rate: number): number {
  return Math.round(amountUsd * rate * 100) / 100;
}

/* -------------------------------------------------------------------------- */
/* API                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Consulta SUNAT. Devuelve `null` ante cualquier problema.
 *
 * Todos los fallos —red, 429, JSON raro, valor absurdo— se tratan igual: no hay
 * dato, que decida quien llama.
 */
async function fetchFromApi(rateDate: string): Promise<number | null> {
  const baseUrl = process.env.EXCHANGE_RATE_API_URL || DEFAULT_API_URL;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const headers: Record<string, string> = { Accept: "application/json" };
    // La API funciona sin token; con él, el límite de peticiones es mayor.
    const token = process.env.EXCHANGE_RATE_API_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${baseUrl}?fecha=${rateDate}`, {
      headers,
      signal: controller.signal,
      cache: "no-store",
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      logger.warn("exchangeRate.api_error", { date: rateDate, status: response.status });
      return null;
    }

    const body = (await response.json()) as SunatResponse;

    // Venta: es el lado que aplica el banco al cobrarte un consumo en dólares.
    const rate = Number(body.venta ?? body.compra);

    // Un tipo de cambio fuera de este rango es un dato corrupto, no una noticia.
    if (!Number.isFinite(rate) || rate <= 1 || rate > 10) {
      logger.warn("exchangeRate.api_invalid_value", { date: rateDate });
      return null;
    }

    logger.info("exchangeRate.api_ok", { date: rateDate, rate });
    return rate;
  } catch (error) {
    logger.warn("exchangeRate.api_failed", { date: rateDate, error: describeError(error) });
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Caché                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * La caché nunca debe tumbar una ingesta.
 *
 * Si la tabla no existe o Supabase falla, se sigue adelante consultando la API:
 * es más lento, pero funciona.
 */
async function readFromCache(rateDate: string): Promise<number | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("exchange_rates")
      .select("usd_pen")
      .eq("rate_date", rateDate)
      .maybeSingle<{ usd_pen: string | number }>();

    if (error || !data) return null;

    const rate = Number(data.usd_pen);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

async function writeToCache(rateDate: string, rate: number): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    await getSupabaseAdmin()
      .from("exchange_rates")
      .upsert({ rate_date: rateDate, usd_pen: rate, source: "SUNAT" }, { onConflict: "rate_date" });
  } catch (error) {
    // Que no se pueda cachear no invalida el tipo de cambio ya obtenido.
    logger.warn("exchangeRate.cache_write_failed", { error: describeError(error) });
  }
}
