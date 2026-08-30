import { formatCurrency } from "@/lib/format";
import { NO_CATEGORY_LABEL } from "@/lib/categories";
import type { CategoryTotal } from "@/types/transaction";

/**
 * Totales por categoría, respetando los filtros activos.
 *
 * Sin gráficos ni librerías: una tabla ordenada de mayor a menor responde la
 * pregunta («¿en qué se me va el dinero?») más rápido que cualquier donut, y no
 * añade dependencias al proyecto.
 */
export function CategoryTotals({ totals }: { totals: CategoryTotal[] }) {
  if (totals.length === 0) return null;

  // `overflow-x-auto` y no `overflow-hidden`: con nombres largos como «Peajes y
  // estacionamiento» la tabla puede pasarse del ancho del móvil, y recortarla
  // escondería cifras. Así se desplaza dentro de su caja, sin arrastrar la
  // página entera.
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full min-w-[20rem] text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
            <th scope="col" className={headingClass}>
              Categoría
            </th>
            <th scope="col" className={`${headingClass} hidden sm:table-cell`}>
              Grupo
            </th>
            <th scope="col" className={`${headingClass} text-right`}>
              Movim.
            </th>
            <th scope="col" className={`${headingClass} text-right`}>
              Total
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {totals.map((row) => (
            <tr key={row.category ?? "__none__"}>
              <td className="px-3 py-2.5 sm:px-4 font-medium text-zinc-900 dark:text-zinc-50">
                {row.category ?? (
                  <span className="text-zinc-500 italic dark:text-zinc-400">
                    {NO_CATEGORY_LABEL}
                  </span>
                )}
              </td>
              <td className="hidden px-4 py-2.5 text-xs text-zinc-500 sm:table-cell dark:text-zinc-400">
                {row.group ?? "—"}
              </td>
              <td className="px-3 py-2.5 sm:px-4 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                {row.count}
              </td>
              <td className="px-3 py-2.5 sm:px-4 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {formatCurrency(row.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const headingClass =
  "px-4 py-2.5 text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400";
