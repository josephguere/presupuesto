/**
 * Catálogo de clasificación: categoría, categoría resumen y grupo.
 *
 * FUENTE ÚNICA DE VERDAD. Ningún componente declara su propia lista ni su propio
 * mapeo: todos importan de aquí.
 *
 * La jerarquía es de tres niveles:
 *
 *     GRUPO  →  CATEGORÍA RESUMEN  →  CATEGORÍA  →  movimiento
 *
 * y se declara ENCADENADA, no por duplicado. Cada categoría dice a qué resumen
 * pertenece, y cada resumen dice a qué grupo. El grupo de una categoría se
 * deduce recorriendo la cadena.
 *
 * Es lo que hace IMPOSIBLE la incoherencia que sí permitiría declarar los dos
 * mapeos por separado: que «Luz» apuntara a «Servicios del hogar» y a la vez a
 * GASTOS VARIABLES mientras el resto de ese resumen fuera GASTOS FIJOS. Aquí no
 * hay dónde escribir esa contradicción.
 *
 * Solo la CATEGORÍA la elige el usuario. Las otras dos se calculan, y por eso no
 * se guardan en la base de datos: se derivan al leer. Así no hay dos verdades
 * que puedan discrepar, y reagrupar categorías mañana no exige migración ni
 * tocar un solo movimiento.
 *
 * AÑADIR UNA CATEGORÍA ES AÑADIR UNA LÍNEA AQUÍ. No hay tabla de categorías, así
 * que no hay migración, ni `seed`, ni riesgo de duplicados al repetirla.
 */

/** Grupos de nivel superior. Los nombres son los que se ven en pantalla. */
export const GROUPS = ["INGRESOS", "GASTOS FIJOS", "GASTOS VARIABLES"] as const;

export type Group = (typeof GROUPS)[number];

/**
 * Categoría resumen → grupo.
 *
 * El orden es el de los desplegables y el de la tabla dinámica del resumen:
 * primero lo que suma, luego lo que se paga todos los meses y al final lo que
 * varía.
 */
const SUMMARY_TO_GROUP = {
  Ingresos: "INGRESOS",

  Suscripciones: "GASTOS FIJOS",
  "Servicios del hogar": "GASTOS FIJOS",
  Educación: "GASTOS FIJOS",
  "Seguros e impuestos": "GASTOS FIJOS",

  Alimentación: "GASTOS VARIABLES",
  Movilidad: "GASTOS VARIABLES",
  Vehículo: "GASTOS VARIABLES",
  "Salud y bienestar": "GASTOS VARIABLES",
  Entretenimiento: "GASTOS VARIABLES",
  Hogar: "GASTOS VARIABLES",
  "Compras personales": "GASTOS VARIABLES",
  "Tecnología y compras": "GASTOS VARIABLES",
  Regalos: "GASTOS VARIABLES",
  Transferencias: "GASTOS VARIABLES",
  Otros: "GASTOS VARIABLES",
} as const satisfies Record<string, Group>;

export type SummaryCategory = keyof typeof SUMMARY_TO_GROUP;

/** Todas las categorías resumen, en el orden en que se muestran. */
export const SUMMARY_CATEGORIES = Object.keys(SUMMARY_TO_GROUP) as SummaryCategory[];

/**
 * Categoría → categoría resumen.
 *
 * El orden es el de los desplegables: agrupadas por resumen para poder recorrer
 * la lista con la vista.
 */
const CATEGORY_TO_SUMMARY = {
  Ingresos: "Ingresos",

  Suscripciones: "Suscripciones",

  Servicios: "Servicios del hogar",
  Luz: "Servicios del hogar",
  "Gas Cálidda": "Servicios del hogar",
  Mantenimiento: "Servicios del hogar",

  Educación: "Educación",

  Seguros: "Seguros e impuestos",
  "Impuestos y tributos": "Seguros e impuestos",

  Supermercado: "Alimentación",
  Restaurantes: "Alimentación",
  Delivery: "Alimentación",
  "Café y snacks": "Alimentación",

  Transporte: "Movilidad",
  "Movilidad Taxi": "Movilidad",
  "Peajes y estacionamiento": "Movilidad",

  Combustible: "Vehículo",
  "Mantenimiento Vehículo": "Vehículo",

  Salud: "Salud y bienestar",
  Farmacia: "Salud y bienestar",
  "Cuidado personal": "Salud y bienestar",

  Entretenimiento: "Entretenimiento",

  Hogar: "Hogar",

  Ropa: "Compras personales",

  Tecnología: "Tecnología y compras",
  "Compras online": "Tecnología y compras",

  Regalos: "Regalos",

  Transferencias: "Transferencias",

  Otros: "Otros",
} as const satisfies Record<string, SummaryCategory>;

export type Category = keyof typeof CATEGORY_TO_SUMMARY;

/** Todas las categorías, en el orden en que se muestran. */
export const CATEGORIES = Object.keys(CATEGORY_TO_SUMMARY) as Category[];

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
  return typeof value === "string" && Object.hasOwn(CATEGORY_TO_SUMMARY, value);
}

/** ¿Es una de las categorías resumen del catálogo? */
export function isValidSummaryCategory(value: unknown): value is SummaryCategory {
  return typeof value === "string" && Object.hasOwn(SUMMARY_TO_GROUP, value);
}

/** ¿Es uno de los tres grupos? */
export function isValidGroup(value: unknown): value is Group {
  return typeof value === "string" && (GROUPS as readonly string[]).includes(value);
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
 * Categoría resumen a la que pertenece una categoría.
 *
 * `null` para «sin categoría» — y también para una categoría desconocida, por si
 * quedara alguna en base de datos de una versión anterior del catálogo.
 */
export function getSummaryForCategory(
  category: string | null | undefined,
): SummaryCategory | null {
  if (!category || !isValidCategory(category)) return null;
  return CATEGORY_TO_SUMMARY[category];
}

/**
 * Grupo al que pertenece una categoría.
 *
 * Se resuelve recorriendo la cadena, no con un mapeo propio: la categoría dice
 * su resumen y el resumen dice su grupo. Un movimiento sin grupo no cuenta como
 * gasto fijo ni variable: aparece en «Pendiente de categorizar».
 */
export function getGroupForCategory(category: string | null | undefined): Group | null {
  const summary = getSummaryForCategory(category);
  return summary ? SUMMARY_TO_GROUP[summary] : null;
}

/** Grupo al que pertenece una categoría resumen. */
export function getGroupForSummary(summary: string | null | undefined): Group | null {
  if (!summary || !isValidSummaryCategory(summary)) return null;
  return SUMMARY_TO_GROUP[summary];
}

/** Categorías que pertenecen a un grupo. Se usa para filtrar en SQL. */
export function getCategoriesInGroup(group: Group): Category[] {
  return CATEGORIES.filter((category) => getGroupForCategory(category) === group);
}

/** Categorías que pertenecen a una categoría resumen. Se usa para filtrar en SQL. */
export function getCategoriesInSummary(summary: SummaryCategory): Category[] {
  return CATEGORIES.filter((category) => CATEGORY_TO_SUMMARY[category] === summary);
}

/** Categorías resumen que pertenecen a un grupo. */
export function getSummariesInGroup(group: Group): SummaryCategory[] {
  return SUMMARY_CATEGORIES.filter((summary) => SUMMARY_TO_GROUP[summary] === group);
}
