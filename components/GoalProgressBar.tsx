import { formatCurrency } from "@/lib/format";

/**
 * Barra de progreso de una meta.
 *
 * EL PORCENTAJE REAL NO SE LIMITA; la barra sí. Un 125 % se escribe 125 % —es el
 * dato, y es justo el que hay que ver— pero el relleno se corta en el 100 %,
 * porque una barra que se sale de su caja no dice «me pasé», dice «está rota».
 *
 * El color no es decorativo: verde mientras queda holgura, ámbar cerca del
 * límite y rojo al pasarse. Y como el color solo no basta —hay quien no lo
 * distingue— la cifra y el «te pasaste» van escritos al lado.
 *
 * Server Component: es marcado puro, sin estado ni eventos.
 */
export function GoalProgressBar({
  gastado,
  meta,
  porcentaje,
}: {
  gastado: number;
  meta: number;
  porcentaje: number;
}) {
  const excedido = porcentaje > 100;
  const ancho = Math.min(porcentaje, 100);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="tabular-nums text-zinc-700 dark:text-zinc-300">
          {formatCurrency(gastado)}{" "}
          <span className="text-zinc-400 dark:text-zinc-500">/ {formatCurrency(meta)}</span>
        </span>
        <span
          className={`font-semibold tabular-nums ${
            excedido
              ? "text-red-600 dark:text-red-400"
              : porcentaje >= 80
                ? "text-amber-600 dark:text-amber-400"
                : "text-zinc-700 dark:text-zinc-300"
          }`}
        >
          {formatPercent(porcentaje)}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={Math.round(porcentaje)}
        aria-valuemin={0}
        // El máximo accesible es 100 aunque el valor lo supere: es lo que
        // describe la BARRA. La cifra exacta va escrita al lado.
        aria-valuemax={100}
        aria-label={`${formatPercent(porcentaje)} de la meta`}
        className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
      >
        <div
          className={`h-full rounded-full transition-[width] ${
            excedido
              ? "bg-red-500"
              : porcentaje >= 80
                ? "bg-amber-500"
                : "bg-emerald-500"
          }`}
          style={{ width: `${ancho}%` }}
        />
      </div>
    </div>
  );
}

/**
 * El porcentaje, sin decimales inútiles.
 *
 * `65 %` y `87.5 %`, no `65.0 %`. La coma decimal es la de `es-PE`.
 */
export function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
  return `${text} %`;
}
