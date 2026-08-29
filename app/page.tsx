import Link from "next/link";
import { SummaryCards } from "@/components/SummaryCards";
import { TransactionsTable } from "@/components/TransactionsTable";
import { SetupNotice } from "@/components/SetupNotice";
import { getCurrentMonth, getMonthlySummary, getTransactions } from "@/lib/transactions";
import { formatMonthLabel } from "@/lib/format";
import { describeError } from "@/lib/logger";
import type { MonthlySummary, Transaction } from "@/types/transaction";

/**
 * Dashboard: métricas del mes en curso y los últimos movimientos.
 *
 * Server Component: la consulta ocurre en el servidor con la service role key,
 * así que el navegador nunca ve credenciales de Supabase.
 */

// Los datos cambian cada vez que llega un correo: nada que cachear entre visitas.
export const dynamic = "force-dynamic";

/** Movimientos que se muestran en la portada; el resto vive en /movimientos. */
const RECENT_LIMIT = 10;

export default async function DashboardPage() {
  const month = getCurrentMonth();

  let summary: MonthlySummary | null = null;
  let recent: Transaction[] = [];
  let error: string | null = null;

  try {
    // Independientes entre sí: se piden en paralelo.
    [summary, recent] = await Promise.all([
      getMonthlySummary(month),
      getTransactions({ limit: RECENT_LIMIT }),
    ]);
  } catch (caught) {
    error = describeError(caught);
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <section className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {formatMonthLabel(month)}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Gastos del mes en curso, hora de Lima.
          </p>
        </div>

        {error ? <SetupNotice message={error} /> : summary && <SummaryCards summary={summary} />}
      </section>

      {!error && (
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

          <TransactionsTable transactions={recent} />
        </section>
      )}
    </div>
  );
}
