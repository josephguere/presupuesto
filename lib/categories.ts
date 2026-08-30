/**
 * Catálogo de categorías y su grupo.
 *
 * FUENTE ÚNICA DE VERDAD. Ningún componente declara su propia lista: todos
 * importan de aquí.
 *
 * Por qué en TypeScript y no en una tabla de Supabase: son dieciocho valores que
 * casi nunca cambian y el grupo es una función pura de la categoría. Una tabla
 * añadiría un JOIN a cada consulta, una pantalla de mantenimiento y la
 * posibilidad de que el grupo guardado se desincronice del catálogo. El día que
 * las categorías necesiten color, presupuesto mensual o jerarquía propia, se
 * normaliza.
 *
 * El GRUPO no se guarda en la base de datos: se deriva de la categoría en el
 * momento de leer. Así nunca hay dos verdades que puedan discrepar, y cambiar la
 * categoría de un movimiento recalcula el grupo sin migración alguna.
 */

/** Grupos de nivel superior. Los nombres son los que se ven en pantalla. */
export const GROUPS = ["INGRESOS", "GASTOS FIJOS", "GASTOS VARIABLES"] as const;

export type Group = (typeof GROUPS)[number];

/**
 * Categorías y su grupo.
 *
 * El orden importa: es el que se ve en los desplegables. «Ingresos» va primero
 * por ser el único que suma en vez de restar.
 */
const CATEGORY_TO_GROUP = {
  Ingresos: "INGRESOS",

  Suscripciones: "GASTOS FIJOS",
  Servicios: "GASTOS FIJOS",
  Educación: "GASTOS FIJOS",

  Supermercado: "GASTOS VARIABLES",
  Restaurantes: "GASTOS VARIABLES",
  Delivery: "GASTOS VARIABLES",
  Transporte: "GASTOS VARIABLES",
  Combustible: "GASTOS VARIABLES",
  Salud: "GASTOS VARIABLES",
  Farmacia: "GASTOS VARIABLES",
  Entretenimiento: "GASTOS VARIABLES",
  Hogar: "GASTOS VARIABLES",
  Ropa: "GASTOS VARIABLES",
  Tecnología: "GASTOS VARIABLES",
  Transferencias: "GASTOS VARIABLES",
  Otros: "GASTOS VARIABLES",
} as const satisfies Record<string, Group>;

export type Category = keyof typeof CATEGORY_TO_GROUP;

/** Todas las categorías, en el orden en que se muestran. */
export const CATEGORIES = Object.keys(CATEGORY_TO_GROUP) as Category[];

/**
 * Valor del `<option>` que representa «Sin categoría».
 *
 * Un `<option value="">` no viaja bien en algunos formularios, así que se usa un
 * centinela explícito que se traduce a `NULL` antes de tocar la base de datos.
 */
export const NO_CATEGORY = "__sin_categoria__";

/** Etiqueta visible de la ausencia de categoría. */
export const NO_CATEGORY_LABEL = "Sin categoría";

/** ¿Es una de las categorías del catálogo? */
export function isValidCategory(value: unknown): value is Category {
  return typeof value === "string" && Object.hasOwn(CATEGORY_TO_GROUP, value);
}

/**
 * Traduce lo que llega de un `<select>` a lo que se guarda.
 *
 * Solo devuelve una categoría del catálogo o `null`. Nunca texto libre del
 * cliente: si el valor no está en la lista, se trata como «sin categoría» y la
 * capa que valida lo rechaza antes de escribir.
 */
export function toStoredCategory(value: string | null | undefined): Category | null {
  if (!value || value === NO_CATEGORY) return null;
  return isValidCategory(value) ? value : null;
}

/**
 * Grupo al que pertenece una categoría.
 *
 * `null` para «sin categoría» — y también para una categoría desconocida, por si
 * quedara alguna en base de datos de una versión anterior del catálogo. Un
 * movimiento sin grupo no cuenta como gasto fijo ni variable: aparece en
 * «Pendiente de categorizar».
 */
export function getGroupForCategory(category: string | null | undefined): Group | null {
  if (!category || !isValidCategory(category)) return null;
  return CATEGORY_TO_GROUP[category];
}

/** Categorías que pertenecen a un grupo. Se usa para filtrar en SQL. */
export function getCategoriesInGroup(group: Group): Category[] {
  return CATEGORIES.filter((category) => CATEGORY_TO_GROUP[category] === group);
}

/** ¿Es uno de los tres grupos? */
export function isValidGroup(value: unknown): value is Group {
  return typeof value === "string" && (GROUPS as readonly string[]).includes(value);
}
