import { isValidCategory, type Category } from "@/lib/categories";
import { merchantFamilyKey, normalizeMerchant } from "./merchant";

/**
 * Sugerencia a partir del historial del propio usuario.
 *
 * Antes de preguntarle a nadie, se mira lo que el usuario ya decidió. Si compró
 * en el mismo sitio y lo categorizó, esa es la respuesta: nadie conoce mejor sus
 * gastos que él.
 *
 * La búsqueda es EN CASCADA y el nivel exacto manda:
 *
 *   1. Comercio idéntico (forma canónica). Decide aunque haya una sola fila.
 *   2. Familia de marca. Solo decide si está ACREDITADA — ver abajo.
 *   3. Nada: que lo resuelva Gemini.
 *
 * Que el nivel exacto no caiga al de familia es deliberado. Si «Yape Movilidad»
 * tiene su propio historial, decide él; bajar a la familia lo ahogaría en el
 * cubo de todo lo que empieza por YAPE, que está repartido entre cuatro
 * categorías.
 */

/** Fila de historial: lo mínimo para decidir. */
export interface HistoryRow {
  merchant: string | null;
  category: string | null;
}

export interface HistoryMatch {
  category: Category;
  /** Cuántos movimientos respaldan la sugerencia. */
  matches: number;
  /** Qué nivel de la cascada decidió. */
  level: "exacto" | "familia";
  /** Proporción de acuerdo, entre 0 y 1. */
  confidence: number;
}

/** Acuerdo mínimo para aceptar un grupo con varias categorías. */
const MIN_AGREEMENT = 0.8;

/**
 * Una familia solo decide si está acreditada.
 *
 * Un único comercio no hace una familia: si «PEDIDOSYA» solo aparece una vez,
 * el nivel exacto ya lo habría resuelto. Exigir varios comercios distintos es lo
 * que evita que una coincidencia de token invente una regla.
 */
const FAMILY_MIN_MERCHANTS = 2;
const FAMILY_MIN_ROWS = 3;

export function pickFromHistory(
  merchant: string | null | undefined,
  rows: HistoryRow[],
): HistoryMatch | null {
  const canonical = normalizeMerchant(merchant);
  if (!canonical) return null;

  // Solo cuentan las filas ya categorizadas: «Sin categoría» no es un precedente.
  const usable = rows.filter((row) => isValidCategory(row.category));

  const exact = usable.filter((row) => normalizeMerchant(row.merchant) === canonical);
  if (exact.length > 0) {
    // El nivel exacto decide o no decide, pero NUNCA delega en la familia.
    return decide(exact, "exacto");
  }

  const family = merchantFamilyKey(merchant);
  if (!family) return null;

  const relatives = usable.filter((row) => merchantFamilyKey(row.merchant) === family);
  if (relatives.length < FAMILY_MIN_ROWS) return null;

  const distinct = new Set(relatives.map((row) => normalizeMerchant(row.merchant)));
  if (distinct.size < FAMILY_MIN_MERCHANTS) return null;

  return decide(relatives, "familia");
}

/**
 * La categoría dominante, si domina de verdad.
 *
 * Con una sola categoría no hay nada que decidir. Con varias hace falta que una
 * llegue al 80 %: por debajo de eso el historial está en conflicto y mentiría
 * presentarlo como una respuesta. Un empate tampoco decide — ahí `>=` sería un
 * error, porque dos categorías al 50 % no dan una ganadora.
 */
function decide(rows: HistoryRow[], level: HistoryMatch["level"]): HistoryMatch | null {
  const counts = new Map<Category, number>();

  for (const row of rows) {
    const category = row.category as Category;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  let best: Category | null = null;
  let bestCount = 0;

  for (const [category, count] of counts) {
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }

  if (!best) return null;

  // Empate: hay otra categoría con el mismo recuento.
  const tied = [...counts.values()].filter((count) => count === bestCount).length > 1;
  if (tied) return null;

  const confidence = bestCount / rows.length;
  if (counts.size > 1 && confidence < MIN_AGREEMENT) return null;

  return { category: best, matches: bestCount, level, confidence };
}
