import Link from "next/link";
import { redirect } from "next/navigation";
import { hasValidSession } from "@/lib/auth/guard";
import { SummaryCards } from "@/components/SummaryCards";
import { CategoryTotals } from "@/components/CategoryTotals";
import { FiltersBar } from "@/components/FiltersBar";
import { TransactionsTable } from "@/components/TransactionsTable";
import { SetupNotice } from "@/components/SetupNotice";
import {
  buildCategoryTotals,
  buildSummary,
  getAvailableMonths,
  getCurrentMonth,
  getTransactions,
  parseFilters,
} from "@/lib/transactions";
import { formatMonthLabel } from "@/lib/format";
import { describeError } from "@/lib/logger";
import type { CategoryTotal, Summary, Transaction } from "@/types/transaction";

/**
 * Resumen: indicadores, totales por categoría y últimos movimientos.
 *
 * Server Component: la consulta ocurre en el servidor con la service role key,
 * así que el navegador nunca ve credenciales de Supabase.
 *
 * Los indicadores se calculan sobre EXACTAMENTE los mismos movimientos que se
 * listan abajo, no con una consulta aparte. Así es imposible que el total y la
 * lista se contradigan.
 */

// Los datos cambian con cada correo: nada que cachear entre visitas.
export const dynamic = "force-dynamic";

/** Movimientos que se muestran en la portada; el resto vive en /movimientos. */
const RECENT_LIMIT = 10;

export default async function ResumenPage(props: PageProps<"/">) {
  // El proxy ya corta antes de llegar aquí; esto es la segunda cerradura,
  // en el mismo proceso que lee los datos.
  if (!(await hasValidSession())) redirect("/login");

  const searchParams = await props.searchParams;
  const { filters, raw, mode } = parseFilters(searchParams);

  // Sin filtros de período, el mes en curso.
  const effectiveFilters =
    mode === "month" && !filters.month ? { ...filters, month: getCurrentMonth() } : filters;

  const periodLabel =
    mode === "range"
      ? rangeLabel(raw.from, raw.to)
      : formatMonthLabel(effectiveFilters.month ?? getCurrentMonth());

  let transactions: Transaction[] = [];
  let summary: Summary | null = null;
  let totals: CategoryTotal[] = [];
  let months: string[] = [];
  let error: string | null = null;

  try {
    [transactions, months] = await Promise.all([
      getTransactions(effectiveFilters),
      getAvailableMonths(),
    ]);
    summary = buildSummary(transactions);
    totals = buildCategoryTotals(transactions);
  } catch (caught) {
    error = describeError(caught);
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{periodLabel}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {describeActiveFilters(raw)} · hora de Lima
        </p>
      </div>

      {error ? (
        <SetupNotice message={error} />
      ) : (
        <>
          <FiltersBar
            action="/"
            months={months}
            values={{ ...raw, month: raw.month ?? effectiveFilters.month }}
            mode={mode}
          />

          {summary && <SummaryCards summary={summary} />}

          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">Por categoría</h2>
            {totals.length > 0 ? (
              <CategoryTotals totals={totals} />
            ) : (
              <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
                No hay movimientos en este período.
              </p>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-semibold tracking-tight">Últimos movimientos</h2>
              <Link
                href="/movimientos"
                className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                Ver todos
              </Link>
            </div>

            {/* Solo lectura: el Resumen no edita nada, ni siquiera la
                categoría. Para cambiar un movimiento se va a Movimientos. */}
            <TransactionsTable
              transactions={transactions.slice(0, RECENT_LIMIT)}
              actions="none"
            />
          </section>
        </>
      )}
    </div>
  );
}

/** Encabezado cuando se filtra por rango en vez de por mes. */
function rangeLabel(from?: string, to?: string): string {
  if (from && to) return `${from} → ${to}`;
  if (from) return `Desde ${from}`;
  if (to) return `Hasta ${to}`;
  return "Rango personalizado";
}

/** Resume en una línea qué filtros están puestos. */
function describeActiveFilters(raw: {
  category?: string;
  group?: string;
}): string {
  const parts: string[] = [];
  if (raw.group) parts.push(raw.group);
  if (raw.category) parts.push(raw.category === "__sin_categoria__" ? "Sin categoría" : raw.category);
  return parts.length > 0 ? parts.join(" · ") : "Todos los movimientos";
}
