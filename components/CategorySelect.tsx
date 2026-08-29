"use client";

import { useOptimistic, useState, useTransition } from "react";
import { updateTransactionCategory } from "@/app/actions";
import { CATEGORIES, NO_CATEGORY } from "@/lib/categories";

/**
 * Selector de categoría de un movimiento.
 *
 * Guarda al cambiar, sin botón: en una tabla de veinte filas, un «Guardar» por
 * fila sería insoportable.
 *
 * El valor se pinta de forma optimista para que el desplegable responda al
 * instante, y se revierte si el servidor falla. Sin eso, el `<select>` se
 * quedaría mostrando el valor viejo hasta que terminase la petición y parecería
 * que no funciona.
 */
export function CategorySelect({
  transactionId,
  category,
}: {
  transactionId: string;
  category: string | null;
}) {
  const saved = category ?? NO_CATEGORY;

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useOptimistic(saved);

  function handleChange(next: string) {
    setError(null);

    startTransition(async () => {
      setOptimistic(next);
      const result = await updateTransactionCategory(transactionId, next);
      // Si falla, React descarta el valor optimista y vuelve al del servidor.
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        aria-label="Categoría del movimiento"
        value={optimistic}
        disabled={isPending}
        onChange={(event) => handleChange(event.target.value)}
        className={`w-full max-w-[11rem] rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-60 ${
          error
            ? "border-red-400 text-red-700 dark:border-red-800 dark:text-red-400"
            : optimistic === NO_CATEGORY
              ? "border-dashed border-zinc-300 bg-transparent text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
              : "border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        }`}
      >
        <option value={NO_CATEGORY}>Sin categoría</option>
        {CATEGORIES.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>

      {error && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400" title={error}>
          !
        </span>
      )}
    </div>
  );
}
