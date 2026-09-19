import { getSupabaseAdmin } from "@/lib/supabase/server";
import { LIMA_TIME_ZONE } from "@/lib/format";
import { shouldShowTestData } from "@/lib/environment";
import {
  DEFAULT_MOVEMENT_SORT,
  parseMovementSort,
  type MovementSort,
} from "@/lib/movementSort";
import {
  getCategoriesInGroup,
  getCategoriesInSummary,
  getGroupForCategory,
  getSummaryForCategory,
  isValidCategory,
  isValidGroup,
  isValidSummaryCategory,
  type Category,
  type Group,
  type SummaryCategory,
} from "@/lib/categories";
import {
  BASE_CURRENCY,
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
  "card_last4, operation_number, category, comment, origin, contabilizar, eliminado_at";

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

/**
 * Estados del filtro de contabilización.
 *
 * Son los dos valores del desplegable con casillas. Ausente = el de por defecto,
 * que es enseñar solo lo que cuenta.
 */
export const ACCOUNTING_VALUES = ["contabilizados", "no-contabilizados"] as const;

export type AccountingValue = (typeof ACCOUNTING_VALUES)[number];

export interface TransactionFilters {
  /** Mes `YYYY-MM`. Se ignora si hay rango personalizado. */
  month?: string;
  /** Rango personalizado `YYYY-MM-DD`. Tiene prioridad sobre `month`. */
  from?: string;
  to?: string;
  /**
   * Categorías seleccionadas. Vacío o ausente = sin restricción.
   *
   * Los tres niveles son listas desde que los filtros admiten varias opciones.
   * Se combinan por INTERSECCIÓN entre niveles y por UNIÓN dentro de cada uno:
   * «resumen ∈ {A,B} Y categoría ∈ {X,Y}». Ver `resolveCategoryFilter`.
   */
  categories?: Category[];
  /** `true` si se pidió explícitamente «Sin categoría». */
  uncategorized?: boolean;
  /** Nivel intermedio: filtra por todas las categorías que agrupan. */
  summaries?: SummaryCategory[];
  groups?: Group[];
  merchant?: string;
  limit?: number;
  /** Por defecto `activos`: un movimiento eliminado no existe para el resto. */
  status?: TransactionStatus;
  /** Por defecto, lo más reciente primero. */
  sort?: MovementSort;
  /**
   * Qué estados de contabilización mostrar.
   *
   * Ausente significa **solo los contabilizados**, que es lo que espera quien
   * abre la aplicación. Los dos valores a la vez muestran ambos.
   *
   * No se aplica en la papelera: ver `getTransactions`.
   */
  accounting?: AccountingValue[];
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
  raw: {
    month?: string;
    from?: string;
    to?: string;
    /** Listas, porque los tres combos admiten varias opciones a la vez. */
    categories: string[];
    summaries: string[];
    groups: string[];
    accounting: string[];
  };
  mode: "month" | "range";
  /**
   * El usuario pidió explícitamente «Todos los meses».
   *
   * Hace falta distinguirlo de «no hay parámetro»: sin esta señal, elegir «todos»
   * enviaría `?mes=` y la pantalla volvería a imponer el mes en curso, así que la
   * opción no funcionaría nunca.
   */
  allMonths: boolean;
  /** Orden pedido en la URL. Se conserva al filtrar y se pierde al limpiar. */
  sort: MovementSort;
}

export function parseFilters(
  params: Record<string, string | string[] | undefined>,
): ParsedFilters {
  const one = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value) || undefined;

  const from = one(params.desde);
  const to = one(params.hasta);
  const monthParam = one(params.mes);

  // Los tres niveles llegan como parametros REPETIDOS
  // (`?categoria=A&categoria=B`), que es lo que envia un grupo de casillas con
  // el mismo `name`. Una URL antigua con un solo valor sigue funcionando: es
  // una lista de uno.
  const categoryParams = manyValues(params.categoria);
  const summaryParams = manyValues(params.categoriaResumen);
  const groupParams = manyValues(params.grupo);
  const accountingParams = manyValues(params.contab);

  const mode: "month" | "range" = usesCustomRange({ from, to }) ? "range" : "month";
  const month = isValidMonth(monthParam) ? monthParam : undefined;

  const filters: TransactionFilters = {};

  if (mode === "range") {
    if (isValidDate(from)) filters.from = from;
    if (isValidDate(to)) filters.to = to;
  } else if (month) {
    filters.month = month;
  }

  // Lo que no esta en el catalogo se descarta en silencio: una URL manipulada
  // produce como mucho una vista sin filtrar, nunca una consulta invalida.
  const categories = categoryParams.filter(isValidCategory);
  if (categories.length > 0) filters.categories = categories;
  if (categoryParams.includes(UNCATEGORIZED_FILTER)) filters.uncategorized = true;

  const summaries = summaryParams.filter(isValidSummaryCategory);
  if (summaries.length > 0) filters.summaries = summaries;

  const groups = groupParams.filter(isValidGroup);
  if (groups.length > 0) filters.groups = groups;

  const accounting = accountingParams.filter(isAccountingValue);
  if (accounting.length > 0) filters.accounting = accounting;

  const sort = parseMovementSort(params.orden);
  if (sort !== DEFAULT_MOVEMENT_SORT) filters.sort = sort;

  return {
    filters,
    raw: {
      month: month,
      from: isValidDate(from) ? from : undefined,
      to: isValidDate(to) ? to : undefined,
      // Se devuelven los valores ACEPTADOS, no los crudos: asi el formulario se
      // repinta con lo que de verdad se aplico y no con lo que se ignoro.
      categories: [
        ...categories,
        ...(filters.uncategorized ? [UNCATEGORIZED_FILTER] : []),
      ],
      summaries,
      groups,
      accounting,
    },
    mode,
    allMonths: firstValue(params.mes) === "",
    sort,
  };
}

/** Primer valor de un parametro repetido, sin convertir la cadena vacia. */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Todos los valores de un parametro, venga repetido o suelto.
 *
 * Las cadenas vacias se descartan: el formulario envia un campo oculto para
 * declarar «este filtro existe aunque no haya nada marcado», y ese centinela no
 * es un valor seleccionable.
 */
function manyValues(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((item) => item.trim().length > 0);
}

/** Es uno de los dos estados de contabilizacion? */
export function isAccountingValue(value: unknown): value is AccountingValue {
  return typeof value === "string" && (ACCOUNTING_VALUES as readonly string[]).includes(value);
}

/**
 * Que categorias admite la combinacion de los tres niveles.
 *
 * PURO, y por eso vive separado de la consulta: la regla —interseccion entre
 * niveles, union dentro de cada uno— es lo unico delicado de todo el filtrado y
 * conviene poder probarla sin base de datos.
 *
 *     `allowed: null`  no hay restriccion de categoria, entran todas.
 *     `allowed: []`    combinacion imposible: no entra ninguna.
 *
 * «Sin categoria» sobrevive solo si NADIE filtro por resumen ni por grupo: un
 * movimiento sin categoria no pertenece a ningun resumen, asi que pedir a la vez
 * «Sin categoria» y «Alimentacion» no podria devolverlo nunca. Se descarta esa
 * parte de la seleccion en lugar de vaciar el resultado entero.
 */
export function resolveCategoryFilter(filters: TransactionFilters): {
  allowed: Category[] | null;
  includeUncategorized: boolean;
} {
  const summaries = filters.summaries ?? [];
  const groups = filters.groups ?? [];
  const categories = filters.categories ?? [];

  let allowed: Category[] | null = null;

  const narrow = (candidates: Category[]) => {
    allowed =
      allowed === null
        ? [...new Set(candidates)]
        : allowed.filter((category) => candidates.includes(category));
  };

  if (summaries.length > 0) {
    narrow(summaries.flatMap((summary) => getCategoriesInSummary(summary)));
  }

  if (groups.length > 0) {
    narrow(groups.flatMap((group) => getCategoriesInGroup(group)));
  }

  if (categories.length > 0) narrow(categories);

  return {
    allowed,
    includeUncategorized:
      Boolean(filters.uncategorized) && summaries.length === 0 && groups.length === 0,
  };
}

/**
 * Que estados de contabilizacion se piden, con el valor por defecto aplicado.
 *
 * `null` significa «no filtres»: o el usuario marco las dos casillas, o estamos
 * en la papelera. En la papelera NO se aplica el valor por defecto a proposito:
 * un movimiento eliminado y ademas no contabilizado desapareceria de la unica
 * pantalla donde se puede recuperar.
 */
export function resolveAccountingFilter(filters: TransactionFilters): boolean | null {
  const requested = filters.accounting ?? [];

  if (requested.length === 0) {
    return filters.status === "eliminados" ? null : true;
  }

  const wantsYes = requested.includes("contabilizados");
  const wantsNo = requested.includes("no-contabilizados");

  if (wantsYes && wantsNo) return null;
  return wantsYes;
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
  // (el orden ya viaja dentro de `parsed.filters`)
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
    summary: getSummaryForCategory(category),
    group: getGroupForCategory(category),
    origin: row.origin ?? "EMAIL",
    // `?? true` para las filas leidas antes de que existiera la columna: la
    // migracion las deja en `true`, y esto cubre cualquier lectura parcial.
    contabilizar: row.contabilizar ?? true,
    deletedAt: row.eliminado_at ?? null,
  };
}

/** Movimientos que cumplen los filtros, del más reciente al más antiguo. */
export async function getTransactions(filters: TransactionFilters = {}): Promise<Transaction[]> {
  // El orden va en la CONSULTA, no sobre el array ya leído: así se ordenan
  // todos los movimientos que cumplen los filtros y no solo los que hubiera
  // cargados, que es lo que importaría el día que haya paginación.
  //
  // Al ordenar por monto, la fecha queda como criterio de desempate: dos gastos
  // iguales se leen mejor del más reciente al más antiguo que en orden
  // arbitrario, que es lo que da la base de datos si no se le dice nada.
  const sort = filters.sort ?? DEFAULT_MOVEMENT_SORT;

  let query = getSupabaseAdmin().from("transactions").select(COLUMNS);

  if (sort === "monto-desc" || sort === "monto-asc") {
    query = query
      .order("amount", { ascending: sort === "monto-asc", nullsFirst: false })
      .order("transaction_at", { ascending: false, nullsFirst: false });
  } else {
    query = query.order("transaction_at", {
      ascending: sort === "antiguos",
      nullsFirst: false,
    });
  }

  query = query.limit(Math.min(filters.limit ?? MAX_ROWS, MAX_ROWS));

  // El rango personalizado manda sobre el mes.
  if (filters.from || filters.to) {
    const range = getCustomRange(filters.from, filters.to);
    if (range.from) query = query.gte("transaction_at", range.from);
    if (range.to) query = query.lt("transaction_at", range.to);
  } else if (isValidMonth(filters.month)) {
    const { from, to } = getMonthRange(filters.month);
    query = query.gte("transaction_at", from).lt("transaction_at", to);
  }

  // Los tres niveles se traducen a UN SOLO filtro sobre `category`, que es lo
  // único que existe en la base de datos. La combinación la resuelve
  // `resolveCategoryFilter`, que es puro y está probado aparte.
  const { allowed, includeUncategorized } = resolveCategoryFilter(filters);

  if (allowed !== null && includeUncategorized) {
    // «Sin categoría» más categorías concretas: hace falta un OR, porque
    // `IS NULL` y `IN (...)` no caben en la misma condición de PostgREST.
    query = query.or(`category.is.null,category.in.(${quoteList(allowed)})`);
  } else if (allowed !== null) {
    // Una lista vacía es una combinación imposible —«Alimentación» + «Luz»—
    // y devuelve cero filas, que es la respuesta correcta.
    query = query.in("category", allowed);
  } else if (includeUncategorized) {
    query = query.is("category", null);
  }

  // Contabilización. Va en la CONSULTA y no al pintar, igual que la baja
  // lógica: así ningún total ni ningún indicador puede olvidarse de excluir
  // lo que el usuario marcó como no contabilizable.
  const accounting = resolveAccountingFilter(filters);
  if (accounting !== null) query = query.eq("contabilizar", accounting);

  if (filters.merchant) query = query.eq("merchant", filters.merchant);

  // Baja lógica. Se aplica SIEMPRE y en la propia consulta, no al pintar: así
  // ninguna vista ni ningún indicador puede olvidarse de excluir las bajas.
  query = query.eq("activo", filters.status !== "eliminados");

  // En producción el dashboard solo enseña movimientos reales; en local, todos.
  if (!shouldShowTestData()) query = query.eq("is_test", false);

  const { data, error } = await query.returns<TransactionRow[]>();
  if (error) throw new Error(`No se pudieron leer los movimientos: ${error.message}`);

  // Sin post-filtrado en memoria: `resolveCategoryFilter` ya intersectó los tres
  // niveles antes de consultar, así que lo que vuelve de PostgreSQL es
  // exactamente lo pedido.
  return (data ?? []).map(toTransaction);
}

/**
 * Lista de valores para un `in.(...)` de PostgREST, entrecomillada.
 *
 * Las comillas no son opcionales: los nombres de categoría llevan espacios y
 * tildes («Cáfe y snacks», «Impuestos y tributos»), y sin comillas PostgREST
 * partiría mal la lista.
 */
function quoteList(values: string[]): string {
  return values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",");
}

/* -------------------------------------------------------------------------- */
/* Agregados                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Los movimientos que participan en los cálculos.
 *
 * Un movimiento con `contabilizar: false` existe, se lista y se edita, pero no
 * suma en ningún sitio. No confundir con estar eliminado: eso lo decide
 * `activo` y se filtra en la consulta.
 */
export function onlyCounted(transactions: Transaction[]): Transaction[] {
  return transactions.filter((transaction) => transaction.contabilizar);
}

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
export function buildSummary(all: Transaction[]): Summary {
  // Lo no contabilizado NO suma, y se descarta AQUÍ además de en la consulta.
  // Es a propósito: la consulta puede pedir los dos estados a la vez —el filtro
  // lo permite— y entonces los indicadores seguirían teniendo que contar solo
  // los que cuentan. Con la comprobación en los dos sitios, ninguna pantalla
  // puede inflar un total por olvidarse de filtrar.
  const transactions = onlyCounted(all);

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

/* -------------------------------------------------------------------------- */
/* Totales del resumen                                                         */
/* -------------------------------------------------------------------------- */

// La agregación vive en `lib/totals.ts`, que es puro y por tanto utilizable
// también desde el navegador. Se reexporta para que quien lea movimientos no
// tenga que saber en qué módulo está cada pieza.
export { buildGroupedTotals, parseTotalsOrder, sortTotals, type TotalsOrder } from "./totals";

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
