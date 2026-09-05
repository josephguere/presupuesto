import { TransactionsTable } from "@/components/TransactionsTable";
import { redirect } from "next/navigation";
import { hasValidSession } from "@/lib/auth/guard";
import { FiltersBar } from "@/components/FiltersBar";
import { MovementDialog } from "@/components/MovementDialog";
import { MovementSortControl } from "@/components/MovementSortControl";
import { SetupNotice } from "@/components/SetupNotice";
import { PageContainer } from "@/components/PageContainer";
import {
  buildSummary,
  getAvailableMonths,
  getTransactions,
  parseFilters,
  withDefaultMonth,
} from "@/lib/transactions";
import { formatCurrency, formatMonthLabel } from "@/lib/format";
import { describeError } from "@/lib/logger";
import {
  DEFAULT_MOVEMENT_SORT,
  MOVEMENT_SORTS,
  type MovementSort,
} from "@/lib/movementSort";
import type { Summary, Transaction } from "@/types/transaction";

/**
 * Todos los movimientos: filtros, alta manual, edición y borrado.
 *
 * Comparte la barra de filtros y el contrato de `searchParams` con el resumen,
 * así que un enlace filtrado funciona igual en las dos pantallas.
 *
 * Al entrar sin filtros se consulta SOLO el mes en curso, igual que el resumen.
 * El mes viaja hasta el `WHERE` de la consulta, así que abrir la pantalla no
 * arrastra el histórico entero para descartarlo después en el navegador. Para
 * ver todo está «Todos los meses» en el desplegable.
 */

export const dynamic = "force-dynamic";

/**
 * A dónde lleva cada opción de orden, con los filtros actuales intactos.
 *
 * El orden por defecto no añade parámetro: la URL limpia es la lista de siempre,
 * y así compartir un enlace sin `orden` significa exactamente eso.
 */
function buildSortHrefs(
  searchParams: Record<string, string | string[] | undefined>,
): Record<MovementSort, string> {
  const base = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "orden" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) base.append(key, item);
  }

  const hrefs = {} as Record<MovementSort, string>;

  for (const option of MOVEMENT_SORTS) {
    const params = new URLSearchParams(base);
    if (option !== DEFAULT_MOVEMENT_SORT) params.set("orden", option);

    const query = params.toString();
    hrefs[option] = query ? `/movimientos?${query}` : "/movimientos";
  }

  return hrefs;
}

/**
 * Qué período se está viendo.
 *
 * Se dice siempre: al entrar solo se consulta el mes en curso, y una lista que
 * no avisa de que está recortada se lee como si fuera el histórico entero.
 */
function describePeriod(
  filters: { month?: string; from?: string; to?: string },
  mode: "month" | "range",
): string {
  if (mode === "range") {
    if (filters.from && filters.to) return `${filters.from} → ${filters.to}`;
    if (filters.from) return `Desde ${filters.from}`;
    if (filters.to) return `Hasta ${filters.to}`;
  }

  return filters.month ? formatMonthLabel(filters.month) : "Todos los meses";
}

export default async function MovimientosPage(props: PageProps<"/movimientos">) {
  // El proxy ya corta antes de llegar aquí; esto es la segunda cerradura,
  // en el mismo proceso que lee los datos.
  if (!(await hasValidSession())) redirect("/login");

  const searchParams = await props.searchParams;
  const parsed = parseFilters(searchParams);
  const { raw, mode, sort } = parsed;
  const filters = withDefaultMonth(parsed);

  // Un enlace por cada orden, construido sobre los parámetros ACTUALES: cambiar
  // el orden no puede perder los filtros puestos. Y como el orden es un
  // parámetro más, «Limpiar» —que apunta a la ruta pelada— lo quita solo.
  const sortHrefs = buildSortHrefs(searchParams);

  let transactions: Transaction[] = [];
  let months: string[] = [];
  let summary: Summary | null = null;
  let error: string | null = null;

  try {
    [transactions, months] = await Promise.all([getTransactions(filters), getAvailableMonths()]);
    summary = buildSummary(transactions);
  } catch (caught) {
    error = describeError(caught);
  }

  return (
    <PageContainer wide className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Movimientos</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {error
              ? "Historial completo."
              : `${describePeriod(filters, mode)} · ${transactions.length} ${
                  transactions.length === 1 ? "movimiento" : "movimientos"
                } · gastos ${formatCurrency(summary?.gastosTotales ?? 0)} · ingresos ${formatCurrency(
                  summary?.ingresos ?? 0,
                )}`}
          </p>
        </div>

        {!error && <MovementDialog trigger="primary" />}
      </div>

      {error ? (
        <SetupNotice message={error} />
      ) : (
        <>
          <FiltersBar
            action="/movimientos"
            months={months}
            values={{ ...raw, month: raw.month ?? filters.month }}
            mode={mode}
            // El orden por defecto no viaja: la URL limpia ya lo significa.
            sort={sort === DEFAULT_MOVEMENT_SORT ? undefined : sort}
          />

          {/* Solo en móvil: en escritorio ordena la cabecera «Monto». */}
          <MovementSortControl value={sort} hrefs={sortHrefs} />

          <TransactionsTable
            transactions={transactions}
            amountSort={{ current: sort, hrefs: sortHrefs }}
          />
        </>
      )}
    </PageContainer>
  );
}
