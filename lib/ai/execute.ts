import {
  buildGroupedTotals,
  buildSummary,
  getTransactions,
  MAX_ROWS,
  type TransactionFilters,
} from "@/lib/transactions";
import { merchantFamilyKey, normalizeMerchant } from "@/lib/suggest/merchant";
import { toTransactionFilters, type ResolvedPeriod } from "@/lib/period";
import { TRUNCATED_WARNING } from "./limits";
import {
  etiquetaFecha,
  metricaConteo,
  metricaMonto,
  metricaPorcentaje,
  round2,
  type ExecutionResult,
  type FilaResultado,
  type FiltrosAplicados,
  type Metrica,
  type PeriodoAplicado,
} from "./result";
import type { Intent, IntentFilters, ListOrder } from "./intent";
import type { MovementSort } from "@/lib/movementSort";
import type { Transaction } from "@/types/transaction";
import type { TotalsNode } from "@/types/transaction";

/**
 * El ejecutor: de una intención validada a datos.
 *
 * ES EL ÚNICO SITIO donde las doce intenciones se convierten en lecturas, y las
 * hace SIEMPRE a través de `getTransactions`, `buildSummary` y
 * `buildGroupedTotals`. Este módulo NO importa `getSupabaseAdmin`, no construye
 * consultas, no nombra tablas ni columnas y nunca pasa `status`. Eso hace que
 * tres garantías salgan gratis en vez de haber que recordarlas:
 *
 *   · Los movimientos ELIMINADOS quedan fuera, porque `getTransactions` filtra
 *     por `activo` en la propia consulta.
 *   · El corte entre datos de prueba y reales se hereda, así que el chat enseña
 *     exactamente lo mismo que la pantalla que el usuario tiene detrás.
 *   · No hay forma de escribir. La capa que se usa solo sabe leer.
 *
 * Los porcentajes y las comparaciones se calculan AQUÍ. Al modelo se le manda el
 * resultado ya hecho porque un modelo de lenguaje calculando la variación entre
 * dos importes es exactamente el uso para el que peor sirve.
 *
 * Cero filas NO es un error: es una respuesta legítima que vuelve con
 * `vacio: true`. Solo se lanza si Supabase falla de verdad.
 */

/** Filas que se enseñan en un desglose antes de agrupar la cola en «otras». */
const MAX_BREAKDOWN_ROWS = 15;

export async function executeIntent(
  intent: Intent,
  period: ResolvedPeriod,
  options: { signal?: AbortSignal; comparePeriod?: ResolvedPeriod } = {},
): Promise<ExecutionResult> {
  const rows = await readPeriod(period, intent.filtros, options.signal);
  const merchant = matchMerchant(rows, intent.filtros.comercio);

  // El emparejamiento por comercio ocurre en memoria: `merchant` en la base de
  // datos es el texto crudo del correo («DLC*PedidosYa KFC Qhatu P») y buscarlo
  // con un `eq` exigiría que el usuario lo escribiera igual. Se reutiliza el
  // normalizador de la sugerencia de categoría para no tener dos criterios.
  const filtradas = merchant ? merchant.rows : rows;

  const filtros: FiltrosAplicados = {
    ...intent.filtros,
    ...(merchant ? { comercioCoincidencia: merchant.nivel } : {}),
  };

  const base = {
    intencion: intent.intencion,
    periodo: toPeriodoAplicado(period),
    filtros,
    truncado: rows.length >= MAX_ROWS,
    avisos: rows.length >= MAX_ROWS ? [TRUNCATED_WARNING] : [],
  };

  // Un comercio que el usuario nombró y que no aparece: no es un fallo, es que
  // no compró ahí en ese período. Se dice, en vez de devolver el total de todo.
  if (intent.filtros.comercio && !merchant) {
    return {
      ...base,
      metricas: [],
      filas: [],
      totalFilas: 0,
      filasOmitidas: 0,
      vacio: true,
      avisos: [
        ...base.avisos,
        `No hay movimientos de «${intent.filtros.comercio}» en el período consultado.`,
      ],
    };
  }

  switch (intent.intencion) {
    case "total_expenses":
    case "total_income":
    case "balance":
    case "transaction_count":
      return { ...base, ...summaryMetrics(intent.intencion, filtradas) };

    case "category_total":
      return { ...base, ...summaryMetrics("total_expenses", filtradas) };

    case "group_total": {
      const delGrupo = filtradas.filter((row) => row.group === intent.filtros.grupo);
      return { ...base, ...summaryMetrics("total_expenses", delGrupo) };
    }

    case "merchant_total":
      return { ...base, ...summaryMetrics("total_expenses", filtradas) };

    case "transaction_list":
      return { ...base, ...listRows(filtradas, intent.orden, intent.limite) };

    case "highest_transactions":
      return { ...base, ...listRows(filtradas, "mayor_monto", intent.limite) };

    case "category_breakdown":
      return { ...base, ...breakdown(filtradas, intent.nivel, intent.filtros) };

    case "group_breakdown":
      return { ...base, ...breakdown(filtradas, "grupo", intent.filtros) };

    case "period_comparison": {
      const compare = options.comparePeriod;
      // La ruta siempre lo pasa; sin él no hay nada que comparar y se degrada al
      // total del período base en lugar de fallar.
      if (!compare) return { ...base, ...summaryMetrics("total_expenses", filtradas) };

      const previas = await readPeriod(compare, intent.filtros, options.signal);
      const comparadas = merchant ? matchMerchant(previas, intent.filtros.comercio)?.rows ?? [] : previas;

      return {
        ...base,
        periodoComparado: toPeriodoAplicado(compare),
        ...comparison(filtradas, comparadas, intent.metrica, period, compare),
      };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Lectura                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Los movimientos del período con los filtros de clasificación aplicados.
 *
 * NO se usan `parseFilters` ni `withDefaultMonth`: `withDefaultMonth` impone el
 * mes en curso cuando no hay período, y aquí «todo el historial» es una petición
 * explícita que quedaría convertida en «este mes» sin ningún síntoma.
 *
 * Tampoco se pasa `limit`: el tope lo pone `MAX_ROWS` dentro de
 * `getTransactions`, y pedir menos daría totales calculados sobre una muestra.
 */
async function readPeriod(
  period: ResolvedPeriod,
  filtros: IntentFilters,
  signal?: AbortSignal,
): Promise<Transaction[]> {
  const query: TransactionFilters = { ...toTransactionFilters(period) };

  // El nivel MÁS específico manda, igual que en la pantalla de Movimientos.
  if (filtros.sinCategoria) query.uncategorized = true;
  else if (filtros.categoria) query.category = filtros.categoria as TransactionFilters["category"];
  else if (filtros.categoriaResumen) query.summary = filtros.categoriaResumen;
  else if (filtros.grupo) query.group = filtros.grupo;

  return getTransactions(query, { signal });
}

/**
 * Filtra por comercio en memoria, de lo estricto a lo laxo.
 *
 * Tres niveles, y se queda en el primero que encuentre algo: nombre normalizado
 * exacto, misma familia de marca —lo que hace que «PedidosYa» encuentre las seis
 * variantes— y por último subcadena. Devuelve `null` si no hay nada, que es
 * distinto de devolver todo.
 */
function matchMerchant(
  rows: Transaction[],
  comercio: string | undefined,
): { rows: Transaction[]; nivel: "exacta" | "familia" | "parcial" } | null {
  if (!comercio) return null;

  const canonico = normalizeMerchant(comercio);
  if (canonico === "") return null;

  const exactas = rows.filter((row) => normalizeMerchant(row.merchant) === canonico);
  if (exactas.length > 0) return { rows: exactas, nivel: "exacta" };

  const familia = merchantFamilyKey(comercio);
  if (familia !== "") {
    const porFamilia = rows.filter((row) => merchantFamilyKey(row.merchant) === familia);
    if (porFamilia.length > 0) return { rows: porFamilia, nivel: "familia" };
  }

  const parciales = rows.filter((row) => normalizeMerchant(row.merchant).includes(canonico));
  return parciales.length > 0 ? { rows: parciales, nivel: "parcial" } : null;
}

/* -------------------------------------------------------------------------- */
/* Formas de respuesta                                                         */
/* -------------------------------------------------------------------------- */

type Partes = Pick<
  ExecutionResult,
  "metricas" | "filas" | "totalFilas" | "filasOmitidas" | "vacio"
>;

/**
 * Totales del período. Se apoya en `buildSummary`, el MISMO que alimenta las
 * tarjetas del resumen, así que el chat y la pantalla no pueden discrepar.
 *
 * El orden de las métricas importa: la primera es la que responde la pregunta y
 * es la que la redacción debe decir en la frase inicial.
 */
function summaryMetrics(
  intencion: "total_expenses" | "total_income" | "balance" | "transaction_count",
  rows: Transaction[],
): Partes {
  const summary = buildSummary(rows);

  const gastos = metricaMonto("gastos", "Gastos del período", summary.gastosTotales);
  const ingresos = metricaMonto("ingresos", "Ingresos del período", summary.ingresos);
  const balance = metricaMonto("balance", "Balance (ingresos − gastos)", summary.balance);
  const conteo = metricaConteo("movimientos", "Movimientos", rows.length);

  const principal: Record<typeof intencion, Metrica[]> = {
    total_expenses: [gastos, conteo, ingresos],
    total_income: [ingresos, conteo],
    balance: [balance, ingresos, gastos],
    transaction_count: [conteo, gastos],
  };

  const metricas = [...principal[intencion]];

  // Lo que no tiene categoría no se reparte entre fijos y variables, así que si
  // hay pendientes el total podría interpretarse mal. Se dice.
  if (summary.pendienteCategorizarCount > 0) {
    metricas.push(
      metricaMonto(
        "pendiente",
        `Sin categoría (${summary.pendienteCategorizarCount})`,
        summary.pendienteCategorizar,
      ),
    );
  }

  return {
    metricas,
    filas: [],
    totalFilas: rows.length,
    filasOmitidas: 0,
    vacio: rows.length === 0,
  };
}

/** Una lista de movimientos, ya ordenada y recortada. */
function listRows(rows: Transaction[], orden: ListOrder, limite: number): Partes {
  const ordenadas = [...rows].sort(comparador(orden));
  const visibles = ordenadas.slice(0, limite);

  const filas: FilaResultado[] = visibles.map((row) => ({
    etiqueta: row.merchant,
    total: round2(row.amount),
    texto: metricaMonto("fila", "", row.amount).texto,
    movimientos: 1,
    fecha: etiquetaFecha(row.transactionAt),
    comercio: row.merchant,
    categoria: row.category,
    resumen: row.summary,
    grupo: row.group,
  }));

  const summary = buildSummary(rows);

  return {
    metricas: [
      metricaConteo("movimientos", "Movimientos en el período", rows.length),
      metricaMonto("gastos", "Gastos del período", summary.gastosTotales),
    ],
    filas,
    totalFilas: rows.length,
    filasOmitidas: Math.max(0, rows.length - visibles.length),
    vacio: rows.length === 0,
  };
}

/** El mismo criterio que la lista de Movimientos, con la fecha como desempate. */
function comparador(orden: ListOrder): (a: Transaction, b: Transaction) => number {
  const porFecha = (a: Transaction, b: Transaction) =>
    (b.transactionAt ?? "").localeCompare(a.transactionAt ?? "");

  switch (orden) {
    case "antiguos":
      return (a, b) => (a.transactionAt ?? "").localeCompare(b.transactionAt ?? "");
    case "mayor_monto":
      return (a, b) => b.amount - a.amount || porFecha(a, b);
    case "menor_monto":
      return (a, b) => a.amount - b.amount || porFecha(a, b);
    default:
      return porFecha;
  }
}

/** Equivalencia con el orden de la pantalla, para poder nombrarlo en la respuesta. */
export function toMovementSort(orden: ListOrder): MovementSort {
  switch (orden) {
    case "antiguos":
      return "antiguos";
    case "mayor_monto":
      return "monto-desc";
    case "menor_monto":
      return "monto-asc";
    default:
      return "recientes";
  }
}

/**
 * Desglose por grupo, resumen o categoría.
 *
 * Se apoya en `buildGroupedTotals`, que suma de abajo arriba y garantiza que los
 * tres niveles cuadran. Aquí solo se aplana el nivel pedido: recalcularlo
 * sumando por separado daría los mismos números hoy y permitiría que dejaran de
 * cuadrar mañana.
 *
 * LOS INGRESOS SE EXCLUYEN salvo que el usuario los pida. Un desglose es la
 * respuesta a «¿en qué gasto más?», y el sueldo es siempre la cifra más alta del
 * mes: sin este filtro, esa pregunta contestaría «Ingresos» con toda la
 * seguridad del mundo. Además el total dejaría de significar nada —sería la suma
 * de lo que entra y lo que sale— y los porcentajes se calcularían contra esa
 * base inflada.
 *
 * Es el mismo criterio que ya aplica `buildSummary` al separar ingresos de
 * gastos; aquí solo se hace explícito.
 */
function breakdown(
  rows: Transaction[],
  nivel: "grupo" | "resumen" | "categoria",
  filtros: IntentFilters,
): Partes {
  const base = pidioIngresos(filtros)
    ? rows
    : rows.filter((row) => row.group !== "INGRESOS");

  const arbol = buildGroupedTotals(base, "mayor");
  const nodos = flatten(arbol, nivel, filtros.grupo);

  const totalPeriodo = nodos.reduce((sum, node) => sum + node.total, 0);

  const todas: FilaResultado[] = nodos.map((node) => ({
    etiqueta: node.label,
    total: round2(node.total),
    texto: metricaMonto("fila", "", node.total).texto,
    movimientos: node.count,
    porcentaje: totalPeriodo > 0 ? Math.round((node.total / totalPeriodo) * 1000) / 10 : 0,
  }));

  const { filas, omitidas } = capRows(todas, MAX_BREAKDOWN_ROWS);

  // La primera fila ES la respuesta a «¿en qué gasto más?».
  const metricas: Metrica[] = [];
  if (todas.length > 0) {
    metricas.push(metricaMonto("mayor", `Mayor: ${todas[0].etiqueta}`, todas[0].total));
  }
  metricas.push(metricaMonto("total", "Total del período", totalPeriodo));
  metricas.push(metricaConteo("movimientos", "Movimientos", base.length));

  return {
    metricas,
    filas,
    totalFilas: todas.length,
    filasOmitidas: omitidas,
    // Vacío se juzga sobre lo que se desglosa: un mes con sueldo y sin un solo
    // gasto no tiene desglose de gastos que enseñar.
    vacio: base.length === 0,
  };
}

/**
 * ¿Pidió el usuario los ingresos explícitamente?
 *
 * Se miran los TRES niveles porque a «Ingresos» se llega por los tres: es un
 * grupo, es una categoría resumen y es una categoría, los tres con ese nombre.
 * Comprobar solo el grupo dejaría fuera «¿cuánto he ingresado por categoría?».
 */
function pidioIngresos(filtros: IntentFilters): boolean {
  return (
    filtros.grupo === "INGRESOS" ||
    filtros.categoriaResumen === "Ingresos" ||
    filtros.categoria === "Ingresos"
  );
}

/** Aplana el árbol al nivel pedido, opcionalmente dentro de un grupo. */
function flatten(
  arbol: TotalsNode[],
  nivel: "grupo" | "resumen" | "categoria",
  grupo: string | undefined,
): TotalsNode[] {
  const raices = grupo ? arbol.filter((node) => node.label === grupo) : arbol;

  if (nivel === "grupo") return raices;

  const resumenes = raices.flatMap((node) => node.children);
  if (nivel === "resumen") return resumenes;

  return resumenes.flatMap((node) => node.children);
}

/**
 * Recorta la cola en una fila «otras».
 *
 * Se resume en vez de tirarse: si se cortaran sin más, la suma de las filas
 * visibles no cuadraría con el total y parecería un error de cálculo.
 */
function capRows(
  filas: FilaResultado[],
  tope: number,
): { filas: FilaResultado[]; omitidas: number } {
  if (filas.length <= tope) return { filas, omitidas: 0 };

  const visibles = filas.slice(0, tope - 1);
  const cola = filas.slice(tope - 1);

  const total = cola.reduce((sum, fila) => sum + fila.total, 0);
  const movimientos = cola.reduce((sum, fila) => sum + fila.movimientos, 0);

  return {
    filas: [
      ...visibles,
      {
        etiqueta: `Otras ${cola.length}`,
        total: round2(total),
        texto: metricaMonto("resto", "", total).texto,
        movimientos,
        esResto: true,
      },
    ],
    omitidas: cola.length,
  };
}

/**
 * Dos períodos, comparados.
 *
 * La variación la calcula ESTE código. Pedírsela al modelo sería pedirle
 * aritmética con decimales, que es su punto más flojo, sobre un dato que el
 * usuario va a creerse.
 */
function comparison(
  actuales: Transaction[],
  previas: Transaction[],
  metrica: "gastos" | "ingresos" | "balance" | "conteo",
  period: ResolvedPeriod,
  compare: ResolvedPeriod,
): Partes {
  const valor = (rows: Transaction[]) => {
    const summary = buildSummary(rows);
    switch (metrica) {
      case "ingresos":
        return summary.ingresos;
      case "balance":
        return summary.balance;
      case "conteo":
        return rows.length;
      default:
        return summary.gastosTotales;
    }
  };

  const ahora = valor(actuales);
  const antes = valor(previas);
  const diferencia = round2(ahora - antes);

  // Sin base no hay porcentaje: dividir entre cero daría Infinity y el modelo lo
  // escribiría tal cual.
  const variacion = antes !== 0 ? ((ahora - antes) / Math.abs(antes)) * 100 : null;

  const construir = (clave: string, etiqueta: string, value: number) =>
    metrica === "conteo"
      ? metricaConteo(clave, etiqueta, value)
      : metricaMonto(clave, etiqueta, value);

  return {
    metricas: [
      construir("actual", period.label, ahora),
      construir("anterior", compare.label, antes),
      construir("diferencia", "Diferencia", diferencia),
      metricaPorcentaje("variacion", "Variación", variacion),
    ],
    filas: [
      {
        etiqueta: period.label,
        total: round2(ahora),
        texto: construir("actual", "", ahora).texto,
        movimientos: actuales.length,
      },
      {
        etiqueta: compare.label,
        total: round2(antes),
        texto: construir("anterior", "", antes).texto,
        movimientos: previas.length,
      },
    ],
    totalFilas: 2,
    filasOmitidas: 0,
    vacio: actuales.length === 0 && previas.length === 0,
  };
}

/** El período, en la forma que viaja en el resultado. */
function toPeriodoAplicado(period: ResolvedPeriod): PeriodoAplicado {
  return {
    tipo: period.kind,
    etiqueta: period.label,
    desde: period.from ?? null,
    hasta: period.to ?? null,
  };
}
