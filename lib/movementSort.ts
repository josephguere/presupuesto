/**
 * Orden de la lista de movimientos.
 *
 * VIVE EN LA URL, no en el estado de un componente. Tres razones:
 *
 *   · Los filtros son un formulario GET, así que aplicarlos NAVEGA. Un orden
 *     guardado en `useState` se perdería en cada filtrado, y el acuerdo dice que
 *     debe conservarse.
 *   · «Limpiar» es un enlace a la ruta pelada, así que quitar el orden al
 *     limpiar sale gratis: no hay nada que reiniciar a mano.
 *   · La cabecera de escritorio y el selector de móvil comparten estado sin
 *     coordinarse, porque ese estado es la propia dirección.
 *
 * Y al estar en la URL, el orden llega hasta el `ORDER BY` de la consulta: se
 * ordenan todos los movimientos que cumplen los filtros, no solo los que ya
 * estuvieran cargados.
 *
 * Módulo puro —sin Supabase— para poder importarlo también desde el cliente.
 */

export const MOVEMENT_SORTS = ["recientes", "antiguos", "monto-desc", "monto-asc"] as const;

export type MovementSort = (typeof MOVEMENT_SORTS)[number];

/** El de siempre: lo último que pasó, primero. */
export const DEFAULT_MOVEMENT_SORT: MovementSort = "recientes";

/** Etiquetas del selector de móvil, en el orden en que se muestran. */
export const MOVEMENT_SORT_LABELS: Record<MovementSort, string> = {
  recientes: "Más recientes",
  antiguos: "Más antiguos",
  "monto-desc": "Mayor monto",
  "monto-asc": "Menor monto",
};

/**
 * Lee el parámetro `orden`. Cualquier cosa rara cae en el orden por defecto.
 *
 * Una URL manipulada debe producir como mucho la lista de siempre, nunca una
 * consulta inválida.
 */
export function parseMovementSort(value: string | string[] | undefined): MovementSort {
  const first = Array.isArray(value) ? value[0] : value;
  return MOVEMENT_SORTS.includes(first as MovementSort)
    ? (first as MovementSort)
    : DEFAULT_MOVEMENT_SORT;
}

/**
 * Qué orden aplica el siguiente clic en la cabecera «Monto».
 *
 * Primer clic: de mayor a menor —que es lo que se quiere ver al buscar en qué se
 * fue el dinero—. Después alterna. Desde cualquier orden por fecha se entra por
 * «mayor», no por donde se saliera.
 */
export function nextAmountSort(current: MovementSort): MovementSort {
  return current === "monto-desc" ? "monto-asc" : "monto-desc";
}

/** Flecha de la cabecera. Vacía si la lista no está ordenada por monto. */
export function amountSortArrow(sort: MovementSort): "" | "↓" | "↑" {
  if (sort === "monto-desc") return "↓";
  if (sort === "monto-asc") return "↑";
  return "";
}

/** Texto para lectores de pantalla: qué hará el clic, no qué se ve. */
export function amountSortLabel(sort: MovementSort): string {
  return nextAmountSort(sort) === "monto-desc"
    ? "Ordenar monto de mayor a menor"
    : "Ordenar monto de menor a mayor";
}
