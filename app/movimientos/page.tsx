import { TransactionsTable } from "@/components/TransactionsTable";
import { redirect } from "next/navigation";
import { hasValidSession } from "@/lib/auth/guard";
import { FiltersBar } from "@/components/FiltersBar";
import { MovementDialog } from "@/components/MovementDialog";
import { SetupNotice } from "@/components/SetupNotice";
import { buildSummary, getAvailableMonths, getTransactions, parseFilters } from "@/lib/transactions";
import { formatCurrency } from "@/lib/format";
import { describeError } from "@/lib/logger";
import type { Summary, Transaction } from "@/types/transaction";

/**
 * Todos los movimientos: filtros, alta manual, edición y borrado.
 *
 * Comparte la barra de filtros y el contrato de `searchParams` con el resumen,
 * así que un enlace filtrado funciona igual en las dos pantallas.
 *
 * A diferencia del resumen, aquí NO se fuerza el mes en curso: entrar a
 * «Movimientos» debe enseñar el historial completo salvo que se filtre.
 */

export const dynamic = "force-dynamic";

export default async function MovimientosPage(props: PageProps<"/movimientos">) {
  // El proxy ya corta antes de llegar aquí; esto es la segunda cerradura,
  // en el mismo proceso que lee los datos.
  if (!(await hasValidSession())) redirect("/login");

  const searchParams = await props.searchParams;
  const { filters, raw, mode } = parseFilters(searchParams);

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
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Movimientos</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {error
              ? "Historial completo."
              : `${transactions.length} ${
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
          <FiltersBar action="/movimientos" months={months} values={raw} mode={mode} />
          <TransactionsTable transactions={transactions} />
        </>
      )}
    </div>
  );
}
