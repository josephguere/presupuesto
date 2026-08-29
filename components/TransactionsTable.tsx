import {
  formatCurrency,
  formatTransactionDate,
  formatTransactionTime,
  maskCard,
} from "@/lib/format";
import type { Transaction } from "@/types/transaction";
import { CategorySelect } from "./CategorySelect";

/**
 * Lista de movimientos.
 *
 * Se renderiza dos veces con los mismos datos: tarjetas apiladas en móvil y
 * tabla a partir de `md`. Es algo más de marcado, pero evita el recurso habitual
 * de meter una tabla de seis columnas en un scroll horizontal — que en un
 * teléfono es incómodo de leer y de tocar.
 */
export function TransactionsTable({ transactions }: { transactions: Transaction[] }) {
  if (transactions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Aún no hay movimientos.</p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
          Aparecerán aquí en cuanto llegue un correo de consumo del BCP.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Móvil */}
      <ul className="space-y-2 md:hidden">
        {transactions.map((transaction) => (
          <li
            key={transaction.id}
            className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-900 dark:text-zinc-50">
                  {transaction.merchant}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {formatTransactionDate(transaction.transactionAt)}
                  {formatTransactionTime(transaction.transactionAt) &&
                    ` · ${formatTransactionTime(transaction.transactionAt)}`}
                </p>
              </div>
              <p className="shrink-0 font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {formatCurrency(transaction.amount, transaction.currency)}
              </p>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {transaction.bank}
              </span>
              <span className="truncate">{transaction.operationType}</span>
              <span className="tabular-nums">{maskCard(transaction.cardLast4)}</span>
            </div>

            <div className="mt-3">
              <CategorySelect
                transactionId={transaction.id}
                category={transaction.category}
              />
            </div>
          </li>
        ))}
      </ul>

      {/* Escritorio */}
      <div className="hidden overflow-hidden rounded-xl border border-zinc-200 bg-white md:block dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
              {["Fecha", "Hora", "Empresa", "Categoría", "Tipo", "Tarjeta"].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="px-4 py-3 text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400"
                >
                  {heading}
                </th>
              ))}
              <th
                scope="col"
                className="px-4 py-3 text-right text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400"
              >
                Monto
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {transactions.map((transaction) => (
              <tr key={transaction.id}>
                <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                  {formatTransactionDate(transaction.transactionAt)}
                </td>
                <td className="px-4 py-3 tabular-nums whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                  {formatTransactionTime(transaction.transactionAt) || "—"}
                </td>
                <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-50">
                  {transaction.merchant}
                </td>
                <td className="px-4 py-2">
                  <CategorySelect
                    transactionId={transaction.id}
                    category={transaction.category}
                  />
                </td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                  {transaction.operationType}
                </td>
                <td className="px-4 py-3 tabular-nums text-zinc-600 dark:text-zinc-400">
                  {maskCard(transaction.cardLast4)}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums whitespace-nowrap text-zinc-900 dark:text-zinc-50">
                  {formatCurrency(transaction.amount, transaction.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
