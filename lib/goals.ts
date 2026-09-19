import { getSupabaseAdmin } from "@/lib/supabase/server";
import { shouldShowTestData } from "@/lib/environment";
import { isValidCategory, type Category } from "@/lib/categories";
import { getCurrentMonth, getTransactions, onlyCounted } from "@/lib/transactions";
import type { Transaction } from "@/types/transaction";

/**
 * Metas de gasto por categoría y mes.
 *
 * UNA META ES UNA ENTIDAD APARTE, no una propiedad del movimiento. Vive en
 * `category_goals` y se relaciona con los movimientos solo al calcular: nadie
 * edita un movimiento para fijar una meta, y borrar una meta no toca ni un solo
 * gasto.
 *
 * LA CATEGORÍA ES TEXTO porque en este proyecto no hay tabla de categorías: la
 * jerarquía vive en `lib/categories.ts` y `transactions.category` es una columna
 * de texto. Las dos se emparejan por igualdad exacta sobre el mismo valor. Ver
 * el comentario de la tabla en `sql/init.sql`.
 *
 * EL GASTO NO SE GUARDA, se calcula al leer, exactamente igual que los totales
 * del resumen. Un «gastado» almacenado se desincronizaría en cuanto se editara,
 * eliminara o dejara de contabilizar un movimiento.
 */

/** Fila de `category_goals`, tal como la devuelve PostgreSQL. */
export interface CategoryGoalRow {
  id: string;
  category: string;
  year: number;
  month: number;
  /** `NUMERIC(12,2)`: supabase-js lo entrega como `string`. */
  amount: string | number;
  is_test: boolean;
  created_at: string;
  updated_at: string;
}

/** Una meta ya lista para usar. */
export interface CategoryGoal {
  id: string;
  category: Category;
  /** `YYYY-MM`, para casar con el resto de la aplicación. */
  month: string;
  amount: number;
}

/**
 * Una meta con su progreso del mes.
 *
 * `porcentaje` NO está limitado a 100: pasarse de la meta es justo lo que hay
 * que ver. Quien recorta es la barra, al pintar.
 */
export interface GoalProgress extends CategoryGoal {
  /** Suma de los movimientos que cuentan, del mes y de la categoría. */
  gastado: number;
  /** `meta - gastado`. Negativo si se pasó. */
  disponible: number;
  /** `gastado / meta * 100`. Puede superar 100. */
  porcentaje: number;
  /** Cuántos movimientos componen el gasto. */
  movimientos: number;
}

/** `YYYY-MM` → sus dos números. */
export function splitMonth(month: string): { year: number; month: number } {
  const [year, monthNumber] = month.split("-").map(Number);
  return { year, month: monthNumber };
}

/** Los dos números → `YYYY-MM`. */
export function joinMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function toGoal(row: CategoryGoalRow): CategoryGoal {
  return {
    id: row.id,
    category: row.category as Category,
    month: joinMonth(row.year, row.month),
    amount: Number(row.amount ?? 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Lectura                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Metas de un mes.
 *
 * Se descartan las de categorías que ya no existen en el catálogo: si alguien
 * renombra una categoría en `lib/categories.ts`, su meta vieja deja de casar con
 * ningún movimiento y mostrarla como «S/ 0 gastado» sería engañoso. La fila NO
 * se borra —los datos históricos no se tocan—, simplemente no se lista.
 */
export async function getGoals(month: string): Promise<CategoryGoal[]> {
  const { year, month: monthNumber } = splitMonth(month);

  let query = getSupabaseAdmin()
    .from("category_goals")
    .select("*")
    .eq("year", year)
    .eq("month", monthNumber)
    .order("category", { ascending: true });

  if (!shouldShowTestData()) query = query.eq("is_test", false);

  const { data, error } = await query.returns<CategoryGoalRow[]>();
  if (error) throw new Error(`No se pudieron leer las metas: ${error.message}`);

  return (data ?? []).map(toGoal).filter((goal) => isValidCategory(goal.category));
}

/**
 * Meses que ya tienen alguna meta, para el desplegable.
 *
 * El mes en curso siempre entra, aunque esté vacío: es donde se empieza.
 */
export async function getGoalMonths(): Promise<string[]> {
  let query = getSupabaseAdmin()
    .from("category_goals")
    .select("year, month")
    .order("year", { ascending: false })
    .order("month", { ascending: false })
    .limit(500);

  if (!shouldShowTestData()) query = query.eq("is_test", false);

  const { data, error } = await query.returns<Array<{ year: number; month: number }>>();
  if (error) throw new Error(`No se pudieron leer los meses de las metas: ${error.message}`);

  const months = new Set<string>((data ?? []).map((row) => joinMonth(row.year, row.month)));
  months.add(getCurrentMonth());

  return [...months].sort().reverse();
}

/* -------------------------------------------------------------------------- */
/* Cálculo                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Cruza metas con gasto real.
 *
 * PURO: recibe los movimientos ya leídos, así que se puede probar sin base de
 * datos y se garantiza que usa EXACTAMENTE los mismos importes en soles que el
 * resumen —la conversión de divisa ocurrió en la ingesta, no aquí—.
 *
 * Qué movimientos entran, y por qué cada condición:
 *
 *   · activos          los eliminados no son gasto. Lo garantiza la consulta.
 *   · contabilizados   lo dice el requisito, y lo aplica `onlyCounted`.
 *   · del mes          lo garantiza la consulta.
 *   · de la categoría  igualdad exacta sobre el mismo texto.
 */
export function buildGoalProgress(
  goals: CategoryGoal[],
  transactions: Transaction[],
): GoalProgress[] {
  const counted = onlyCounted(transactions);

  return goals.map((goal) => {
    const own = counted.filter((transaction) => transaction.category === goal.category);
    const gastado = round2(own.reduce((total, transaction) => total + transaction.amount, 0));

    return {
      ...goal,
      gastado,
      disponible: round2(goal.amount - gastado),
      // La meta es siempre > 0 por restricción de la tabla, así que no hay
      // división entre cero que cubrir.
      porcentaje: Math.round((gastado / goal.amount) * 1000) / 10,
      movimientos: own.length,
    };
  });
}

/** Totales de la cabecera: lo presupuestado y lo gastado del mes. */
export function summarizeGoals(progress: GoalProgress[]): {
  meta: number;
  gastado: number;
  disponible: number;
  porcentaje: number;
} {
  const meta = round2(progress.reduce((total, item) => total + item.amount, 0));
  const gastado = round2(progress.reduce((total, item) => total + item.gastado, 0));

  return {
    meta,
    gastado,
    disponible: round2(meta - gastado),
    porcentaje: meta > 0 ? Math.round((gastado / meta) * 1000) / 10 : 0,
  };
}

/**
 * Metas de un mes con su progreso, listas para pintar.
 *
 * Lee los movimientos con los MISMOS filtros que el resto de la aplicación
 * —activos y contabilizados por defecto— para que el gasto de una meta coincida
 * con lo que enseña el resumen de ese mes.
 */
export async function getGoalsWithProgress(month: string): Promise<GoalProgress[]> {
  const [goals, transactions] = await Promise.all([
    getGoals(month),
    getTransactions({ month }),
  ]);

  return buildGoalProgress(goals, transactions);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
