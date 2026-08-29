import { getSupabaseAdmin } from "@/lib/supabase/server";
import { LIMA_TIME_ZONE } from "@/lib/format";
import type { MonthlySummary, Transaction, TransactionRow } from "@/types/transaction";

/**
 * Lectura de movimientos para el dashboard.
 *
 * Todas estas funciones se ejecutan en Server Components, con la service role
 * key. El navegador nunca habla con Supabase.
 *
 * Los cálculos del resumen se hacen en JavaScript en vez de con SQL agregado:
 * con los movimientos de un mes son unas pocas decenas de filas y el código se
 * lee de un vistazo. Si algún día son miles, esto se convierte en una vista de
 * PostgreSQL sin tocar la interfaz.
 */

/** Moneda base del resumen. */
const BASE_CURRENCY = "PEN";

/** Tope de filas por consulta: red de seguridad, no paginación. */
const MAX_ROWS = 500;

const COLUMNS =
  "id, bank, operation_type, transaction_at, amount, currency, merchant, card_last4, operation_number, category";

/** Mes `YYYY-MM` actual **en Lima**, no en la zona del servidor. */
export function getCurrentMonth(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LIMA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}

/** `YYYY-MM` con formato válido. */
export function isValidMonth(month: string | undefined): month is string {
  return typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

/**
 * Límites de un mes en hora de Lima, como intervalo semiabierto `[desde, hasta)`.
 *
 * El intervalo semiabierto evita el clásico error de incluir o perder el último
 * movimiento del mes por un segundo.
 */
function getMonthRange(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const pad = (value: number) => String(value).padStart(2, "0");

  return {
    from: `${year}-${pad(monthNumber)}-01T00:00:00-05:00`,
    to: `${nextYear}-${pad(nextMonth)}-01T00:00:00-05:00`,
  };
}

/**
 * Convierte una fila de PostgreSQL en un movimiento listo para pintar.
 *
 * `NUMERIC` llega como string desde supabase-js (para no perder precisión), así
 * que la conversión a número ocurre aquí y en ningún otro sitio.
 */
function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    bank: row.bank ?? "—",
    operationType: row.operation_type ?? "—",
    transactionAt: row.transaction_at,
    amount: Number(row.amount ?? 0),
    currency: row.currency ?? BASE_CURRENCY,
    merchant: row.merchant ?? "—",
    cardLast4: row.card_last4,
    operationNumber: row.operation_number,
    category: row.category,
  };
}

export interface TransactionFilters {
  /** Mes `YYYY-MM`. Sin valor, no se filtra por fecha. */
  month?: string;
  /** Nombre exacto del comercio. */
  merchant?: string;
  limit?: number;
}

/** Movimientos ordenados del más reciente al más antiguo. */
export async function getTransactions(filters: TransactionFilters = {}): Promise<Transaction[]> {
  let query = getSupabaseAdmin()
    .from("transactions")
    .select(COLUMNS)
    .order("transaction_at", { ascending: false })
    .limit(Math.min(filters.limit ?? MAX_ROWS, MAX_ROWS));

  if (filters.month && isValidMonth(filters.month)) {
    const { from, to } = getMonthRange(filters.month);
    query = query.gte("transaction_at", from).lt("transaction_at", to);
  }

  if (filters.merchant) {
    query = query.eq("merchant", filters.merchant);
  }

  const { data, error } = await query.returns<TransactionRow[]>();
  if (error) throw new Error(`No se pudieron leer los movimientos: ${error.message}`);

  return (data ?? []).map(toTransaction);
}

/**
 * Métricas del mes: total, número de movimientos, promedio y mayor gasto.
 *
 * Solo se agregan movimientos en la moneda base: sumar soles con dólares daría
 * un número sin significado. Hoy el MVP solo produce PEN, pero la regla queda
 * escrita para cuando llegue una tarjeta en dólares.
 */
export async function getMonthlySummary(month: string): Promise<MonthlySummary> {
  const transactions = (await getTransactions({ month })).filter(
    (transaction) => transaction.currency === BASE_CURRENCY,
  );

  const amounts = transactions.map((transaction) => transaction.amount);
  const totalSpent = amounts.reduce((sum, amount) => sum + amount, 0);

  return {
    month,
    totalSpent,
    transactionCount: transactions.length,
    averageAmount: amounts.length > 0 ? totalSpent / amounts.length : 0,
    largestAmount: amounts.length > 0 ? Math.max(...amounts) : 0,
    currency: BASE_CURRENCY,
  };
}

/** Meses con movimientos, del más reciente al más antiguo, para el filtro. */
export async function getAvailableMonths(): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("transactions")
    .select("transaction_at")
    .not("transaction_at", "is", null)
    .order("transaction_at", { ascending: false })
    .limit(MAX_ROWS)
    .returns<Array<{ transaction_at: string }>>();

  if (error) throw new Error(`No se pudieron leer los meses: ${error.message}`);

  const monthFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: LIMA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  });

  const months = new Set<string>();
  for (const row of data ?? []) {
    months.add(monthFormatter.format(new Date(row.transaction_at)));
  }

  return [...months].sort().reverse();
}

/** Comercios con movimientos, en orden alfabético, para el filtro. */
export async function getAvailableMerchants(): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("transactions")
    .select("merchant")
    .not("merchant", "is", null)
    .limit(MAX_ROWS)
    .returns<Array<{ merchant: string }>>();

  if (error) throw new Error(`No se pudieron leer los comercios: ${error.message}`);

  return [...new Set((data ?? []).map((row) => row.merchant))].sort((a, b) =>
    a.localeCompare(b, "es"),
  );
}
