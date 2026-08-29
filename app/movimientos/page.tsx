import { TransactionsTable } from "@/components/TransactionsTable";
import { SetupNotice } from "@/components/SetupNotice";
import {
  getAvailableMerchants,
  getAvailableMonths,
  getTransactions,
  isValidMonth,
} from "@/lib/transactions";
import { formatCurrency, formatMonthLabel } from "@/lib/format";
import { describeError } from "@/lib/logger";
import type { Transaction } from "@/types/transaction";

/**
 * Todos los movimientos, con filtros por mes y por empresa.
 *
 * Los filtros son un `<form method="get">` normal: el estado vive en la URL y el
 * filtrado ocurre en el servidor. Cero JavaScript de cliente, la vista es
 * enlazable y compartible, y funciona aunque falle la hidratación.
 */

export const dynamic = "force-dynamic";

/** Valor centinela de los `<select>`: los `<option>` vacíos no se envían igual. */
const ALL = "todos";

export default async function MovimientosPage(props: PageProps<"/movimientos">) {
  const searchParams = await props.searchParams;

  const monthParam = firstValue(searchParams.mes);
  const merchantParam = firstValue(searchParams.empresa);

  const month = isValidMonth(monthParam) ? monthParam : undefined;
  const merchant = merchantParam && merchantParam !== ALL ? merchantParam : undefined;

  let transactions: Transaction[] = [];
  let months: string[] = [];
  let merchants: string[] = [];
  let error: string | null = null;

  try {
    [transactions, months, merchants] = await Promise.all([
      getTransactions({ month, merchant }),
      getAvailableMonths(),
      getAvailableMerchants(),
    ]);
  } catch (caught) {
    error = describeError(caught);
  }

  const total = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Movimientos</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {error
            ? "Historial completo de consumos."
            : `${transactions.length} ${
                transactions.length === 1 ? "movimiento" : "movimientos"
              } · ${formatCurrency(total)}`}
        </p>
      </div>

      {error ? (
        <SetupNotice message={error} />
      ) : (
        <>
          <form
            method="get"
            className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 sm:flex-row sm:items-end dark:border-zinc-800 dark:bg-zinc-900"
          >
            <Field label="Mes" name="mes" defaultValue={month ?? ALL}>
              <option value={ALL}>Todos los meses</option>
              {months.map((value) => (
                <option key={value} value={value}>
                  {formatMonthLabel(value)}
                </option>
              ))}
            </Field>

            <Field label="Empresa" name="empresa" defaultValue={merchant ?? ALL}>
              <option value={ALL}>Todas las empresas</option>
              {merchants.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Field>

            <div className="flex gap-2">
              <button
                type="submit"
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Filtrar
              </button>

              {(month || merchant) && (
                <a
                  href="/movimientos"
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Limpiar
                </a>
              )}
            </div>
          </form>

          <TransactionsTable transactions={transactions} />
        </>
      )}
    </div>
  );
}

/** Etiqueta + `<select>`, para no repetir las mismas clases en cada filtro. */
function Field({
  label,
  name,
  defaultValue,
  children,
}: {
  label: string;
  name: string;
  defaultValue: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1.5">
      <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        {label}
      </span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
      >
        {children}
      </select>
    </label>
  );
}

/** Un `searchParam` puede repetirse en la URL; nos quedamos con el primero. */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
