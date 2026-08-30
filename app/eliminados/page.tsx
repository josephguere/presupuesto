import Link from "next/link";
import { redirect } from "next/navigation";
import { hasValidSession } from "@/lib/auth/guard";
import { TransactionsTable } from "@/components/TransactionsTable";
import { FiltersBar } from "@/components/FiltersBar";
import { SetupNotice } from "@/components/SetupNotice";
import { getAvailableMonths, getTransactions, parseFilters } from "@/lib/transactions";
import { describeError } from "@/lib/logger";
import type { Transaction } from "@/types/transaction";

/**
 * Papelera: los movimientos dados de baja.
 *
 * Es la única pantalla que pide `status: "eliminados"`. Todo lo demás —Resumen,
 * Movimientos, indicadores, totales por categoría— consulta solo los activos,
 * así que lo que se ve aquí no suma en ningún cálculo del presupuesto.
 *
 * No se muestran indicadores a propósito: un total de «lo eliminado» invitaría a
 * interpretarlo como gasto, que es justo lo contrario de lo que significa.
 *
 * Tampoco se edita. La única acción es restaurar; si hay que corregir algo, se
 * restaura primero y se edita después en Movimientos.
 */

export const dynamic = "force-dynamic";

export default async function EliminadosPage(props: PageProps<"/eliminados">) {
  // El proxy ya corta antes de llegar aquí; esto es la segunda cerradura,
  // en el mismo proceso que lee los datos.
  if (!(await hasValidSession())) redirect("/login");

  const searchParams = await props.searchParams;
  const { filters, raw, mode } = parseFilters(searchParams);

  let transactions: Transaction[] = [];
  let months: string[] = [];
  let error: string | null = null;

  try {
    [transactions, months] = await Promise.all([
      getTransactions({ ...filters, status: "eliminados" }),
      getAvailableMonths("eliminados"),
    ]);
  } catch (caught) {
    error = describeError(caught);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Eliminados</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {error ? (
            "Movimientos dados de baja."
          ) : (
            <>
              {transactions.length}{" "}
              {transactions.length === 1 ? "movimiento eliminado" : "movimientos eliminados"} · no
              cuentan en{" "}
              <Link href="/" className="underline hover:no-underline">
                el resumen
              </Link>{" "}
              ni en los indicadores
            </>
          )}
        </p>
      </div>

      {error ? (
        <SetupNotice message={error} />
      ) : (
        <>
          <FiltersBar action="/eliminados" months={months} values={raw} mode={mode} />
          <TransactionsTable
            transactions={transactions}
            actions="restore"
            emptyMessage="No hay movimientos eliminados."
          />
        </>
      )}
    </div>
  );
}
