"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  MOVEMENT_SORTS,
  MOVEMENT_SORT_LABELS,
  type MovementSort,
} from "@/lib/movementSort";

/**
 * Selector de orden para móvil.
 *
 * En móvil los movimientos son tarjetas, así que no hay cabecera de columna que
 * pulsar. Esto la sustituye, y solo aparece por debajo de `lg`: en escritorio la
 * cabecera «Monto» ya hace el mismo trabajo y tener los dos controles a la vez
 * invitaría a preguntarse cuál manda.
 *
 * Navega en lugar de guardar estado. El orden vive en la URL —ver
 * `lib/movementSort.ts`—, de modo que la cabecera de escritorio y este selector
 * comparten el mismo valor sin coordinarse, y cambiar el tamaño de la ventana no
 * lo pierde.
 *
 * Es lo único de esta funcionalidad que necesita JavaScript: un `<select>` que
 * navegue al cambiar no se puede hacer sin él. Si no cargara, el orden sigue
 * siendo alcanzable desde la cabecera de escritorio y desde la propia URL.
 */
export function MovementSortControl({
  value,
  hrefs,
}: {
  value: MovementSort;
  /** A dónde ir por cada orden, con los filtros actuales ya dentro. */
  hrefs: Record<MovementSort, string>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <label className="flex flex-col gap-1.5 lg:hidden">
      <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        Ordenar por
      </span>

      <select
        value={value}
        disabled={isPending}
        onChange={(event) =>
          startTransition(() => router.push(hrefs[event.target.value as MovementSort]))
        }
        // Mismo aspecto que los campos de la barra de filtros, y a ancho
        // completo: en una pantalla táctil un control estrecho se falla.
        className="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
      >
        {MOVEMENT_SORTS.map((sort) => (
          <option key={sort} value={sort}>
            {MOVEMENT_SORT_LABELS[sort]}
          </option>
        ))}
      </select>
    </label>
  );
}
