import { getSupabaseAdmin } from "@/lib/supabase/server";
import { shouldShowTestData } from "@/lib/environment";
import { deaccent } from "@/lib/parsers/normalize";
import { describeError, logger } from "@/lib/logger";
import {
  CATEGORIES,
  GROUPS,
  SUMMARY_CATEGORIES,
  getGroupForCategory,
  getGroupForSummary,
  getSummaryForCategory,
  type Category,
  type Group,
  type SummaryCategory,
} from "@/lib/categories";

/**
 * El catálogo VIGENTE de categorías, resúmenes y grupos.
 *
 * ES HÍBRIDO, y conviene entender por qué antes de tocarlo.
 *
 * En este proyecto NO hay tabla de categorías. `transactions.category` es una
 * columna de texto y la jerarquía —qué resumen y qué grupo le corresponden a cada
 * categoría— vive únicamente en `lib/categories.ts`, que la deriva al leer para
 * poder reagrupar sin migración. Así que hay dos mitades y cada una está en un
 * sitio distinto:
 *
 *   · QUÉ CATEGORÍAS EXISTEN  →  es un dato, y se consulta a Supabase.
 *   · A QUÉ GRUPO PERTENECEN  →  no es un dato, y se une desde el código.
 *
 * La unión de las dos es lo que hace verdad que «las categorías nuevas queden
 * disponibles automáticamente» por los dos caminos posibles: una categoría que
 * aparezca en los datos entra sola, y una que se añada a `lib/categories.ts`
 * entra sola y además con su grupo. Aquí no hay ninguna lista escrita a mano.
 *
 * LAS HUÉRFANAS —en datos pero no en el código— se conservan a propósito. Son
 * consultables: `getTransactions` filtra por la columna, así que sus importes
 * suman bien. Lo único que no tienen es grupo, porque nadie se lo ha asignado, y
 * eso se dice en vez de inventarlo.
 *
 * El catálogo se carga UNA vez por mensaje y se pasa como parámetro. Sin caché de
 * módulo: una función serverless vive poco, un TTL añadiría una ventana en la que
 * una categoría recién creada no aparece, y la consulta es un `GROUP BY` sobre un
 * índice.
 */

/** Lo que el modelo responde cuando un nivel no aplica. Espejo del de `suggest`. */
export const CATALOG_NONE = "NINGUNA";

/** Tope de valores por enum: una anomalía en los datos no puede inflar el esquema. */
const MAX_ENUM_VALUES = 200;

/** Por debajo de esto no se arriesga una corrección ortográfica. */
const MIN_FUZZY_LENGTH = 5;

export type CatalogLevel = "categoria" | "resumen" | "grupo";

export interface CatalogEntry {
  /** Nombre canónico. Es lo ÚNICO que puede acabar en un `.eq("category", …)`. */
  nombre: string;
  /** `catalogKey(nombre)`, precalculada. */
  clave: string;
  resumen: SummaryCategory | null;
  grupo: Group | null;
  /** Movimientos activos con esta categoría. `0` para las que solo están en código. */
  movimientos: number;
  /** En los datos pero no en el catálogo de código: sin resumen ni grupo. */
  huerfana: boolean;
}

export interface Catalog {
  categorias: CatalogEntry[];
  resumenes: Array<{ nombre: SummaryCategory; clave: string; grupo: Group }>;
  grupos: Array<{ nombre: Group; clave: string }>;
  /** Cuántas vienen solo de los datos. Va al log, no a la respuesta. */
  huerfanas: number;
}

/** Una fila del `GROUP BY category`. */
export interface CategoryUsageRow {
  category: string | null;
  movimientos: number;
}

/* -------------------------------------------------------------------------- */
/* Construcción                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Une lo que dicen los datos con lo que dice el código.
 *
 * PURO: recibe las filas ya leídas. Separarlo de la consulta permite probar la
 * unión —y sobre todo el caso de la huérfana— sin ningún doble de Supabase.
 *
 * El orden es el del catálogo de código primero y las huérfanas al final. Es el
 * mismo orden que ven los desplegables de la aplicación, y así el `enum` que se
 * le manda al modelo se lee como la lista que el usuario conoce.
 */
export function buildCatalog(rows: CategoryUsageRow[]): Catalog {
  const uso = new Map<string, number>();
  for (const row of rows) {
    const nombre = row.category?.trim();
    if (nombre) uso.set(nombre, (uso.get(nombre) ?? 0) + Number(row.movimientos ?? 0));
  }

  const categorias: CatalogEntry[] = CATEGORIES.map((nombre) => ({
    nombre,
    clave: catalogKey(nombre),
    resumen: getSummaryForCategory(nombre),
    grupo: getGroupForCategory(nombre),
    movimientos: uso.get(nombre) ?? 0,
    huerfana: false,
  }));

  const conocidas = new Set<string>(CATEGORIES);

  for (const [nombre, movimientos] of uso) {
    if (conocidas.has(nombre)) continue;

    categorias.push({
      nombre,
      clave: catalogKey(nombre),
      resumen: null,
      grupo: null,
      movimientos,
      huerfana: true,
    });
  }

  return {
    categorias: categorias.slice(0, MAX_ENUM_VALUES),
    resumenes: SUMMARY_CATEGORIES.map((nombre) => ({
      nombre,
      clave: catalogKey(nombre),
      grupo: getGroupForSummary(nombre)!,
    })),
    grupos: GROUPS.map((nombre) => ({ nombre, clave: catalogKey(nombre) })),
    huerfanas: categorias.filter((entry) => entry.huerfana).length,
  };
}

/**
 * Qué categorías hay en los datos, y cuántos movimientos tiene cada una.
 *
 * Va por la función `catalogo_categorias`, que hace el `GROUP BY` en PostgreSQL.
 * PostgREST no tiene DISTINCT, así que la alternativa sería traerse las filas y
 * deduplicar en memoria —lo que hace `getAvailableMonths`—, y con el tope de mil
 * filas una categoría poco usada desaparecería del catálogo sin ningún síntoma.
 *
 * Si la función no está desplegada, el catálogo se queda con el del código y se
 * registra el aviso. Es una degradación honesta: el chat sigue funcionando con
 * las veintinueve categorías de siempre y solo se pierden las huérfanas, que por
 * definición son las que aún no tienen grupo.
 */
export async function loadCategoryUsage(signal?: AbortSignal): Promise<CategoryUsageRow[]> {
  const query = getSupabaseAdmin().rpc("catalogo_categorias", {
    p_incluir_prueba: shouldShowTestData(),
  });

  const { data, error } = await (signal ? query.abortSignal(signal) : query);

  if (error) {
    logger.warn("ai.catalog.rpc_failed", {
      funcion: "catalogo_categorias",
      detalle: error.message,
    });
    return [];
  }

  return (Array.isArray(data) ? data : []).map((row) => ({
    category: (row as { categoria?: string | null }).categoria ?? null,
    movimientos: Number((row as { movimientos?: number }).movimientos ?? 0),
  }));
}

/** El catálogo vigente. Una consulta, una unión. */
export async function loadCatalog(signal?: AbortSignal): Promise<Catalog> {
  try {
    return buildCatalog(await loadCategoryUsage(signal));
  } catch (error) {
    // Que falle el catálogo no puede tumbar el chat: se sigue con el del código.
    logger.warn("ai.catalog.failed", { error: describeError(error) });
    return buildCatalog([]);
  }
}

/* -------------------------------------------------------------------------- */
/* Lo que ve el modelo                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Los tres `enum` del `responseSchema`.
 *
 * Es LA JAULA: el modelo no puede nombrar una categoría que no esté aquí, así que
 * una alucinación —o una inyección— no puede producir un filtro sobre algo que no
 * existe. El centinela permite decir «este nivel no aplica» sin salirse del enum.
 */
export function catalogEnums(catalog: Catalog): {
  categorias: string[];
  resumenes: string[];
  grupos: string[];
} {
  return {
    categorias: [...catalog.categorias.map((entry) => entry.nombre), CATALOG_NONE],
    resumenes: [...catalog.resumenes.map((entry) => entry.nombre), CATALOG_NONE],
    grupos: [...catalog.grupos.map((entry) => entry.nombre), CATALOG_NONE],
  };
}

/**
 * El catálogo como texto jerárquico para el prompt.
 *
 * El `enum` restringe pero no explica: sin ver que «Delivery» cuelga de
 * «Alimentación» y esta de GASTOS VARIABLES, el modelo no puede traducir «¿en qué
 * grupo gasto más?» al nivel correcto.
 */
export function describeCatalog(catalog: Catalog): string {
  const lineas: string[] = [];

  for (const grupo of catalog.grupos) {
    lineas.push(grupo.nombre);

    for (const resumen of catalog.resumenes.filter((s) => s.grupo === grupo.nombre)) {
      const hijas = catalog.categorias
        .filter((entry) => entry.resumen === resumen.nombre)
        .map((entry) => entry.nombre);

      lineas.push(`  ${resumen.nombre}: ${hijas.join(", ")}`);
    }
  }

  const huerfanas = catalog.categorias.filter((entry) => entry.huerfana);
  if (huerfanas.length > 0) {
    lineas.push(`SIN GRUPO ASIGNADO: ${huerfanas.map((entry) => entry.nombre).join(", ")}`);
  }

  return lineas.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Emparejamiento                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Clave de comparación: sin tildes, sin mayúsculas, sin puntuación y en singular.
 *
 * Es lo que hace que «delivery», «Delivery» y «DELIVERY» sean lo mismo, y también
 * «transferencia» y «Transferencias». El plural se recorta solo en palabras de
 * más de tres letras, para no convertir «gas» en «ga».
 */
export function catalogKey(value: string): string {
  return deaccent(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token))
    .join(" ");
}

export type CatalogMatch =
  | { estado: "encontrada"; nivel: CatalogLevel; valor: string }
  | { estado: "ambigua"; nivel: CatalogLevel; candidatos: string[] }
  | { estado: "desconocida"; sugerencias: string[] };

/**
 * Resuelve un término contra un nivel del catálogo.
 *
 * La cascada va de lo seguro a lo arriesgado y para en cuanto acierta:
 *
 *   1. El nombre exacto.
 *   2. La clave normalizada (tildes, mayúsculas, plural).
 *   3. Subcadena, solo si hay UN candidato.
 *   4. Distancia de edición 1, solo si hay UN candidato y el término es largo.
 *
 * Varios candidatos NO deciden: devuelven «ambigua». Coger el primero daría una
 * respuesta con aspecto correcto sobre la categoría equivocada, que es peor que
 * preguntar.
 */
function resolveIn(
  entries: Array<{ nombre: string; clave: string }>,
  nivel: CatalogLevel,
  term: unknown,
): CatalogMatch {
  if (typeof term !== "string") return { estado: "desconocida", sugerencias: [] };

  const limpio = term.trim();
  if (limpio === "" || limpio === CATALOG_NONE) {
    return { estado: "desconocida", sugerencias: [] };
  }

  const exacta = entries.find((entry) => entry.nombre === limpio);
  if (exacta) return { estado: "encontrada", nivel, valor: exacta.nombre };

  const clave = catalogKey(limpio);
  if (clave === "") return { estado: "desconocida", sugerencias: [] };

  const porClave = entries.filter((entry) => entry.clave === clave);
  if (porClave.length === 1) {
    return { estado: "encontrada", nivel, valor: porClave[0].nombre };
  }
  if (porClave.length > 1) {
    return { estado: "ambigua", nivel, candidatos: porClave.map((entry) => entry.nombre) };
  }

  const porSubcadena = entries.filter(
    (entry) => entry.clave.includes(clave) || clave.includes(entry.clave),
  );
  if (porSubcadena.length === 1) {
    return { estado: "encontrada", nivel, valor: porSubcadena[0].nombre };
  }
  if (porSubcadena.length > 1) {
    return {
      estado: "ambigua",
      nivel,
      candidatos: porSubcadena.map((entry) => entry.nombre),
    };
  }

  // La corrección ortográfica solo en términos largos: con tres letras, una
  // errata de distancia 1 es literalmente otra palabra.
  if (clave.length >= MIN_FUZZY_LENGTH) {
    const cercanas = entries.filter(
      (entry) => editDistanceAtMost(clave, entry.clave, 1) !== null,
    );
    if (cercanas.length === 1) {
      return { estado: "encontrada", nivel, valor: cercanas[0].nombre };
    }
  }

  return { estado: "desconocida", sugerencias: nearest(entries, clave) };
}

export function resolveCategoryMatch(catalog: Catalog, term: unknown): CatalogMatch {
  return resolveIn(catalog.categorias, "categoria", term);
}

export function resolveSummaryMatch(catalog: Catalog, term: unknown): CatalogMatch {
  return resolveIn(catalog.resumenes, "resumen", term);
}

export function resolveGroupMatch(catalog: Catalog, term: unknown): CatalogMatch {
  return resolveIn(catalog.grupos, "grupo", term);
}

/** El nombre canónico, o `null`. La forma corta para quien no necesita el motivo. */
export function resolveCategory(catalog: Catalog, term: unknown): string | null {
  const match = resolveCategoryMatch(catalog, term);
  return match.estado === "encontrada" ? match.valor : null;
}

export function resolveSummary(catalog: Catalog, term: unknown): SummaryCategory | null {
  const match = resolveSummaryMatch(catalog, term);
  return match.estado === "encontrada" ? (match.valor as SummaryCategory) : null;
}

export function resolveGroup(catalog: Catalog, term: unknown): Group | null {
  const match = resolveGroupMatch(catalog, term);
  return match.estado === "encontrada" ? (match.valor as Group) : null;
}

/**
 * ¿Es una categoría del catálogo VIGENTE?
 *
 * Distinto de `isValidCategory` de `lib/categories.ts`, que solo conoce las del
 * código: esta acepta también las huérfanas, que existen en los datos y por tanto
 * se pueden consultar.
 */
export function isCatalogCategory(catalog: Catalog, value: unknown): value is Category {
  return (
    typeof value === "string" && catalog.categorias.some((entry) => entry.nombre === value)
  );
}

/**
 * Distancia de edición con transposición, cortada en `max`.
 *
 * Se corta a propósito: no interesa saber si dos cadenas están a distancia 9, solo
 * si están a 1. Con el corte, el bucle abandona en cuanto la fila entera supera el
 * umbral.
 */
export function editDistanceAtMost(a: string, b: string, max: number): number | null {
  if (Math.abs(a.length - b.length) > max) return null;
  if (a === b) return 0;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let beforePrevious: number[] = [];

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      let value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);

      // Transposición: «Delviery» por «Delivery» es un solo error, no dos.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, beforePrevious[j - 2] + 1);
      }

      current.push(value);
      best = Math.min(best, value);
    }

    if (best > max) return null;

    beforePrevious = previous;
    previous = current;
  }

  const distance = previous[b.length];
  return distance <= max ? distance : null;
}

/** Las tres entradas con la clave más parecida, para sugerir sin inventar. */
function nearest(entries: Array<{ nombre: string; clave: string }>, clave: string): string[] {
  return entries
    .map((entry) => ({
      nombre: entry.nombre,
      distancia: editDistanceAtMost(clave, entry.clave, 3) ?? Number.MAX_SAFE_INTEGER,
    }))
    .filter((candidate) => candidate.distancia < Number.MAX_SAFE_INTEGER)
    .sort((a, b) => a.distancia - b.distancia)
    .slice(0, 3)
    .map((candidate) => candidate.nombre);
}

/**
 * El mensaje de «no existe» o «cuál de estas».
 *
 * PLANTILLA FIJA DEL SERVIDOR. Lo redacta este código, no el modelo, y solo puede
 * nombrar valores que están de verdad en el catálogo: es texto que se pinta en la
 * interfaz del usuario y no debe poder contener nada que venga de fuera.
 */
export function describeUnknownTerm(term: string, match: CatalogMatch): string {
  const limpio = term.trim().slice(0, 60);

  if (match.estado === "ambigua") {
    return `«${limpio}» puede referirse a varias: ${match.candidatos.join(", ")}. ¿Cuál quieres?`;
  }

  if (match.estado === "desconocida" && match.sugerencias.length > 0) {
    return `No tengo ninguna categoría llamada «${limpio}». ¿Querías decir ${match.sugerencias.join(
      ", ",
    )}?`;
  }

  return `No tengo ninguna categoría llamada «${limpio}» entre tus movimientos.`;
}
