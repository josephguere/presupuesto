/**
 * Categorías de gasto.
 *
 * Una lista fija en TypeScript, no una tabla de la base de datos. Con una docena
 * de valores que casi nunca cambian, una tabla `categories` solo añadiría un
 * JOIN a cada consulta y una pantalla de mantenimiento que nadie usaría. El día
 * que necesiten color, presupuesto mensual o jerarquía, se normaliza; hasta
 * entonces esto es todo lo que hace falta.
 *
 * En la base de datos se guarda el texto tal cual en `transactions.category`, y
 * `NULL` significa «sin categoría».
 */

export const CATEGORIES = [
  "Supermercado",
  "Restaurantes",
  "Delivery",
  "Transporte",
  "Combustible",
  "Salud",
  "Farmacia",
  "Suscripciones",
  "Entretenimiento",
  "Hogar",
  "Servicios",
  "Ropa",
  "Educación",
  "Tecnología",
  "Transferencias",
  "Otros",
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Valor del `<option>` que representa «sin categoría».
 *
 * Un `<option value="">` no viaja bien en algunos formularios, así que se usa un
 * centinela explícito que se traduce a `NULL` antes de tocar la base de datos.
 */
export const NO_CATEGORY = "__sin_categoria__";

/** ¿Es una de las categorías que aceptamos? */
export function isValidCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

/**
 * Traduce lo que llega del `<select>` a lo que se guarda.
 *
 * Solo devuelve un valor de la lista o `null`; cualquier otra cosa se rechaza en
 * la Server Action. Nunca se guarda texto libre del cliente.
 */
export function toStoredCategory(value: string): Category | null {
  if (value === NO_CATEGORY || value === "") return null;
  return isValidCategory(value) ? value : null;
}
