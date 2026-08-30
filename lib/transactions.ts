import { getSupabaseAdmin } from "@/lib/supabase/server";
import { LIMA_TIME_ZONE } from "@/lib/format";
import { shouldShowTestData } from "@/lib/environment";
import {
  getCategoriesInGroup,
  getGroupForCategory,
  isValidCategory,
  isValidGroup,
  type Category,
  type Group,
} from "@/lib/categories";
import {
  BASE_CURRENCY,
  type CategoryTotal,
  type Summary,
  type Transaction,
  type TransactionRow,
} from "@/types/transaction";

/**
 * Lectura de movimientos, resumen y filtros.
 *
 * Todo se ejecuta en Server Components con la service role key: el navegador
 * nunca habla con Supabase.
 *
 * Los agregados se calculan en JavaScript sobre las filas ya filtradas, no con
 * SQL agregado. Con los movimientos de un mes son unas pocas decenas de filas,
 * el código se lee de un vistazo y —esto es lo que decide— el GRUPO se deriva de
 * la categoría en TypeScript, así que agregarlo en SQL exigiría duplicar el
 * catálogo dentro de la consulta. Si algún día son miles de filas, esto se
 * convierte en una vista de PostgreSQL sin tocar la interfaz.
 */

/** Tope de filas por consulta: red de seguridad, no paginación. */
const MAX_ROWS = 1000;

const COLUMNS =
  "id, bank, operation_type, transaction_at, amount, currency, merchant, " +
  "card_last4, operation_number, category, comment, origin, eliminado_at";

/**
 * Qué movimientos pedir segun su baja logica.
 *
 * `activos` es lo que ve el usuario en Resumen y Movimientos; `eliminados`
 * alimenta la pantalla de papelera. Nunca se piden los dos a la vez: mezclar
 * bajas con movimientos vivos falsearia cualquier total.
 */
export type TransactionStatus = "activos" | "eliminados";

/* -------------------------------------------------------------------------- */
/* Fechas                                                                      */
/* -------------------------------------------------------------------------- */

/** Mes `YYYY-MM` actual **en Lima**, no en la zona del servidor. */
export function getCurrentMonth(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LIMA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}

/** `YYYY-MM` con formato válido. */
export function isValidMonth(month: string | undefined | null): month is string {
  return typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

/** `YYYY-MM-DD` con formato válido. */
export function isValidDate(value: string | undefined | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

const pad = (value: number) => String(value).padStart(2, "0");

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

  return {
    from: `${year}-${pad(monthNumber)}-01T00:00:00-05:00`,
    to: `${nextYear}-${pad(nextMonth)}-01T00:00:00-05:00`,
  };
}

/** Un rango de fechas inclusivo por los dos extremos, en hora de Lima. */
function getCustomRange(from?: string, to?: string): { from?: string; to?: string } {
  const range: { from?: string; to?: string } = {};

  if (isValidDate(from)) range.from = `${from}T00:00:00-05:00`;
  if (isValidDate(to)) {
    // El día "hasta" entra entero: se toma el inicio del día siguiente.
    const next = new Date(`${to}T00:00:00-05:00`);
    next.setDate(next.getDate() + 1);
    const y = next.getFullYear();
    range.to = `${y}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T00:00:00-05:00`;
  }

  return range;
}

/* -------------------------------------------------------------------------- */
/* Filtros                                                                     */
/* -------------------------------------------------------------------------- */

export interface TransactionFilters {
  /** Mes `YYYY-MM`. Se ignora si hay rango personalizado. */
  month?: string;
  /** Rango personalizado `YYYY-MM-DD`. Tiene prioridad sobre `month`. */
  from?: string;
  to?: string;
  category?: Category;
  /** `true` para quedarse solo con los que no tienen categoría. */
  uncategorized?: boolean;
  group?: Group;
  merchant?: string;
  limit?: number;
  /** Por defecto `activos`: un movimiento eliminado no existe para el resto. */
  status?: TransactionStatus;
}

/** ¿Está el usuario filtrando por rango personalizado en vez de por mes? */
export function usesCustomRange(filters: {
  from?: string | null;
  to?: string | null;
}): boolean {
  return isValidDate(filters.from) || isValidDate(filters.to);
}

/**
 * Convierte los `searchParams` de la URL en filtros ya validados.
 *
 * Todo lo que no reconoce se descarta en silencio: una URL manipulada produce
 * como mucho una vista sin filtrar, nunca una consulta inválida.
 */
export interface ParsedFilters {
  filters: TransactionFilters;
  /** Los valores tal como deben repintarse en el formulario. */
  raw: { month?: string; from?: string; to?: string; category?: string; group?: string };
  mode: "month" | "range";
  /**
   * El usuario pidió explícitamente «Todos los meses».
   *
   * Hace falta distinguirlo de «no hay parámetro»: sin esta señal, elegir «todos»
   * enviaría `?mes=` y la pantalla volvería a imponer el mes en curso, así que la
   * opción no funcionaría nunca.
   */
  allMonths: boolean;
}

export function parseFilters(
  params: Record<string, string | string[] | undefined>,
): ParsedFilters {
  const one = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value) || undefined;

  const from = one(params.desde);
  const to = one(params.hasta);
  const monthParam = one(params.mes);
  const categoryParam = one(params.categoria);
  const groupParam = one(params.grupo);

  const mode: "month" | "range" = usesCustomRange({ from, to }) ? "range" : "month";
  const month = isValidMonth(monthParam) ? monthParam : undefined;

  const filters: TransactionFilters = {};

  if (mode === "range") {
    if (isValidDate(from)) filters.from = from;
    if (isValidDate(to)) filters.to = to;
  } else if (month) {
    filters.month = month;
  }

  if (categoryParam === UNCATEGORIZED_FILTER) filters.uncategorized = true;
  else if (isValidCategory(categoryParam)) filters.category = categoryParam;

  if (isValidGroup(groupParam)) filters.group = groupParam;

  return {
    filters,
    raw: {
      month: month,
      from: isValidDate(from) ? from : undefined,
      to: isValidDate(to) ? to : undefined,
      category: categoryParam,
      group: groupParam,
    },
    mode,
    // `mes=` vacío es la opción «Todos los meses» del desplegable. Un `mes`
    // inválido no cuenta: se trata como si no viniera y se aplica el mes actual.
    allMonths: firstValue(params.mes) === "",
  };
}

/** Primer valor de un parámetro repetido, sin convertir la cadena vacía. */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Aplica el mes en curso cuando el usuario no ha pedido otra cosa.
 *
 * ES UNA DECISIÓN DE RENDIMIENTO, no de presentación: el mes acaba en el `WHERE`
 * de la consulta, así que al entrar se leen las filas de un mes y no el
 * histórico entero. Lo comparten Resumen y Movimientos para que ambas pantallas
 * pidan exactamente lo mismo.
 *
 * Se respeta lo que el usuario elija: un rango personalizado manda, un mes
 * concreto manda, y «Todos los meses» consulta todo a propósito.
 */
export function withDefaultMonth(parsed: ParsedFilters): TransactionFilters {
  if (parsed.mode === "range") return parsed.filters;
  if (parsed.filters.month) return parsed.filters;
  if (parsed.allMonths) return parsed.filters;

  return { ...parsed.filters, month: getCurrentMonth() };
}

/** Valor del filtro de categoría que representa «solo los que no tienen». */
export const UNCATEGORIZED_FILTER = "__sin_categoria__";

/* -------------------------------------------------------------------------- */
/* Lectura                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Convierte una fila de PostgreSQL en un movimiento listo para pintar.
 *
 * Aquí —y solo aquí— ocurren dos cosas: `NUMERIC` pasa de string a número, y el
 * GRUPO se deriva de la categoría.
 */
function toTransaction(row: TransactionRow): Transaction {
  const category = isValidCategory(row.category) ? row.category : null;

  return {
    id: row.id,
    bank: row.bank ?? "—",
    operationType: row.operation_type ?? "—",
    transactionAt: row.transaction_at,
    amount: Number(row.amount ?? 0),
    merchant: row.merchant ?? "—",
    cardLast4: row.card_last4,
    operationNumber: row.operation_number,
    comment: row.comment,
    category,
    group: getGroupForCategory(category),
    origin: row.origin ?? "EMAIL",
    deletedAt: row.eliminado_at ?? null,
  };
}

/** Movimientos que cumplen los filtros, del más reciente al más antiguo. */
export async function getTransactions(filters: TransactionFilters = {}): Promise<Transaction[]> {
  let query = getSupabaseAdmin()
    .from("transactions")
    .select(COLUMNS)
    .order("transaction_at", { ascending: false, nullsFirst: false })
    .limit(Math.min(filters.limit ?? MAX_ROWS, MAX_ROWS));

  // El rango personalizado manda sobre el mes.
  if (filters.from || filters.to) {
    const range = getCustomRange(filters.from, filters.to);
    if (range.from) query = query.gte("transaction_at", range.from);
    if (range.to) query = query.lt("transaction_at", range.to);
  } else if (isValidMonth(filters.month)) {
    const { from, to } = getMonthRange(filters.month);
    query = query.gte("transaction_at", from).lt("transaction_at", to);
  }

  if (filters.uncategorized) {
    query = query.is("category", null);
  } else if (filters.category) {
    query = query.eq("category", filters.category);
  } else if (filters.group) {
    // El grupo se deriva de la categoría, así que filtrar por grupo es filtrar
    // por el conjunto de categorías que lo componen.
    query = query.in("category", getCategoriesInGroup(filters.group));
  }

  if (filters.merchant) query = query.eq("merchant", filters.merchant);

  // Baja lógica. Se aplica SIEMPRE y en la propia consulta, no al pintar: así
  // ninguna vista ni ningún indicador puede olvidarse de excluir las bajas.
  query = query.eq("activo", filters.status !== "eliminados");

  // En producción el dashboard solo enseña movimientos reales; en local, todos.
  if (!shouldShowTestData()) query = query.eq("is_test", false);

  const { data, error } = await query.returns<TransactionRow[]>();
  if (error) throw new Error(`No se pudieron leer los movimientos: ${error.message}`);

  let rows = (data ?? []).map(toTransaction);

  // Si se combinan grupo Y categoría, la consulta ya filtró por categoría; queda
  // comprobar que además pertenezca al grupo pedido.
  if (filters.group && filters.category) {
    rows = rows.filter((transaction) => transaction.group === filters.group);
  }

  return rows;
}

/* -------------------------------------------------------------------------- */
/* Agregados                                                                   */
/* -------------------------------------------------------------------------- */

/** Suma de importes de una lista. */
function sum(transactions: Transaction[]): number {
  return round2(transactions.reduce((total, transaction) => total + transaction.amount, 0));
}

/** Los importes se redondean al sumar para no arrastrar errores de coma flotante. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Indicadores del resumen, calculados sobre los movimientos ya filtrados.
 *
 * Los movimientos sin categoría NO se reparten entre gastos fijos y variables:
 * se cuentan aparte en «Pendiente de categorizar». Repartirlos daría totales que
 * parecen correctos y no lo son.
 */
export function buildSummary(transactions: Transaction[]): Summary {
  const ingresos = sum(transactions.filter((t) => t.group === "INGRESOS"));
  const gastosFijos = sum(transactions.filter((t) => t.group === "GASTOS FIJOS"));
  const gastosVariables = sum(transactions.filter((t) => t.group === "GASTOS VARIABLES"));
  const pendientes = transactions.filter((t) => t.category === null);

  const gastosTotales = round2(gastosFijos + gastosVariables);

  // Métricas de gasto originales: todo lo que no sea un ingreso.
  const gastos = transactions.filter((t) => t.group !== "INGRESOS");
  const importesGasto = gastos.map((t) => t.amount);
  const totalSpent = sum(gastos);

  return {
    ingresos,
    gastosFijos,
    gastosVariables,
    gastosTotales,
    balance: round2(ingresos - gastosTotales),
    pendienteCategorizar: sum(pendientes),
    pendienteCategorizarCount: pendientes.length,

    totalSpent,
    transactionCount: gastos.length,
    averageAmount: importesGasto.length > 0 ? round2(totalSpent / importesGasto.length) : 0,
    largestAmount: importesGasto.length > 0 ? Math.max(...importesGasto) : 0,
  };
}

/** Totales por categoría, de mayor a menor importe. */
export function buildCategoryTotals(transactions: Transaction[]): CategoryTotal[] {
  const byCategory = new Map<string, CategoryTotal>();

  for (const transaction of transactions) {
    const key = transaction.category ?? "__none__";
    const current = byCategory.get(key);

    if (current) {
      current.total = round2(current.total + transaction.amount);
      current.count += 1;
    } else {
      byCategory.set(key, {
        category: transaction.category,
        group: transaction.group,
        total: transaction.amount,
        count: 1,
      });
    }
  }

  return [...byCategory.values()].sort((a, b) => b.total - a.total);
}

/* -------------------------------------------------------------------------- */
/* Catálogos para los desplegables                                             */
/* -------------------------------------------------------------------------- */

/**
 * Meses con movimientos, del más reciente al más antiguo.
 *
 * El estado importa: el desplegable de «Eliminados» debe ofrecer los meses de
 * las bajas, no los de los movimientos vivos.
 */
export async function getAvailableMonths(
  status: TransactionStatus = "activos",
): Promise<string[]> {
  let query = getSupabaseAdmin()
    .from("transactions")
    .select("transaction_at")
    .not("transaction_at", "is", null)
    .eq("activo", status !== "eliminados")
    .order("transaction_at", { ascending: false })
    .limit(MAX_ROWS);

  if (!shouldShowTestData()) query = query.eq("is_test", false);

  const { data, error } = await query.returns<Array<{ transaction_at: string }>>();
  if (error) throw new Error(`No se pudieron leer los meses: ${error.message}`);

  const monthFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: LIMA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  });

  const months = new Set<string>();
  for (const row of data ?? []) months.add(monthFormatter.format(new Date(row.transaction_at)));

  // El mes en curso siempre debe poder elegirse, aunque aún no tenga nada. En
  // la papelera no: ofrecer un mes sin ninguna baja solo lleva a una lista vacía.
  if (status !== "eliminados") months.add(getCurrentMonth());

  return [...months].sort().reverse();
}

export { BASE_CURRENCY };
