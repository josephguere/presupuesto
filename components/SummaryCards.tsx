import { formatCurrency } from "@/lib/format";
import type { Summary } from "@/types/transaction";

/**
 * Indicadores del resumen.
 *
 * Dos bloques con intención distinta:
 *
 *   1. Los tres grupos, el total y el balance — la lectura de «cómo voy».
 *   2. Las métricas de gasto que ya existían, más lo pendiente de categorizar.
 *
 * Todos responden a los filtros activos y todos van en soles.
 *
 * `min-w-0` en las celdas para que una etiqueta larga —«Pendiente de
 * categorizar»— pueda encogerse en vez de estirar la columna y desbordar.
 */
export function SummaryCards({ summary }: { summary: Summary }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5 [&>*]:min-w-0">
        <Card label="Ingresos" value={summary.ingresos} tone="positive" />
        <Card label="Gastos fijos" value={summary.gastosFijos} />
        <Card label="Gastos variables" value={summary.gastosVariables} />
        <Card label="Gastos totales" value={summary.gastosTotales} tone="negative" />
        <Card
          label="Balance"
          value={summary.balance}
          tone={summary.balance >= 0 ? "positive" : "negative"}
          emphasis
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5 [&>*]:min-w-0">
        <Card label="Gastado" value={summary.totalSpent} muted />
        <Card label="Movimientos" value={summary.transactionCount} muted raw />
        <Card label="Promedio" value={summary.averageAmount} muted />
        <Card label="Mayor gasto" value={summary.largestAmount} muted />
        <Card
          label="Pendiente de categorizar"
          value={summary.pendienteCategorizar}
          muted
          hint={
            summary.pendienteCategorizarCount > 0
              ? `${summary.pendienteCategorizarCount} ${
                  summary.pendienteCategorizarCount === 1 ? "movimiento" : "movimientos"
                }`
              : "todo clasificado"
          }
        />
      </div>
    </div>
  );
}

function Card({
  label,
  value,
  tone,
  emphasis,
  muted,
  raw,
  hint,
}: {
  label: string;
  value: number;
  tone?: "positive" | "negative";
  emphasis?: boolean;
  muted?: boolean;
  /** `true` para un contador, que no lleva símbolo de moneda. */
  raw?: boolean;
  hint?: string;
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "negative"
        ? "text-red-700 dark:text-red-400"
        : "text-zinc-900 dark:text-zinc-50";

  return (
    <div
      className={`rounded-xl border p-4 ${
        muted
          ? "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      }`}
    >
      <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        {label}
      </p>
      <p
        className={`mt-1.5 font-semibold tabular-nums ${
          emphasis ? "text-xl sm:text-2xl" : "text-lg sm:text-xl"
        } ${toneClass}`}
      >
        {raw ? value : formatCurrency(value)}
      </p>
      {hint && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">{hint}</p>}
    </div>
  );
}
