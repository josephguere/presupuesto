import { formatCurrency } from "@/lib/format";
import type { MonthlySummary } from "@/types/transaction";

/**
 * Las cuatro métricas del mes.
 *
 * Dos columnas en móvil y cuatro a partir de `lg`: en un teléfono, cuatro
 * tarjetas en fila dejarían las cifras ilegibles.
 */
export function SummaryCards({ summary }: { summary: MonthlySummary }) {
  const cards = [
    {
      label: "Gastado",
      value: formatCurrency(summary.totalSpent, summary.currency),
      emphasis: true,
    },
    {
      label: "Movimientos",
      value: String(summary.transactionCount),
      emphasis: false,
    },
    {
      label: "Promedio",
      value: formatCurrency(summary.averageAmount, summary.currency),
      emphasis: false,
    },
    {
      label: "Mayor gasto",
      value: formatCurrency(summary.largestAmount, summary.currency),
      emphasis: false,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            {card.label}
          </p>
          <p
            className={`mt-2 font-semibold tabular-nums ${
              card.emphasis
                ? "text-2xl text-zinc-900 sm:text-3xl dark:text-zinc-50"
                : "text-xl text-zinc-800 sm:text-2xl dark:text-zinc-100"
            }`}
          >
            {card.value}
          </p>
        </div>
      ))}
    </div>
  );
}
