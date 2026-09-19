"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { parseGoalForm, toGoalRecord } from "@/lib/goalSchema";
import { toFieldErrors } from "@/lib/movementSchema";
import { shouldMarkAsTest } from "@/lib/environment";
import { SESSION_REQUIRED_MESSAGE, hasValidSession } from "@/lib/auth/guard";
import { describeError, logger } from "@/lib/logger";
import type { ActionResult } from "@/app/actions";

/**
 * Server Actions de las metas: guardar y eliminar.
 *
 * Mismas reglas que `app/actions.ts` —sesión comprobada aquí, validación contra
 * un esquema cerrado, nunca se confía en el cliente— porque una Server Action es
 * un endpoint público que escribe con la `service_role` key.
 *
 * NO TOCAN NINGÚN MOVIMIENTO. Una meta es una entidad aparte: crearla, cambiarla
 * o borrarla no modifica, reclasifica ni elimina un solo gasto.
 *
 * Están en su propio archivo y no junto a las de movimientos para que quede
 * evidente en el árbol qué escribe en `transactions` y qué en `category_goals`.
 */

const UuidSchema = z.string().uuid();

/** Código de PostgreSQL para violación de restricción única. */
const PG_UNIQUE_VIOLATION = "23505";

/** Metas y resumen comparten los mismos movimientos: ambas vistas caducan. */
function revalidateGoals(): void {
  revalidatePath("/metas");
  revalidatePath("/");
}

async function requireSession(): Promise<ActionResult | null> {
  if (await hasValidSession()) return null;

  logger.warn("action.unauthorized");
  return { ok: false, message: SESSION_REQUIRED_MESSAGE };
}

/**
 * Crea la meta del mes, o actualiza la que ya hubiera.
 *
 * Es un `upsert` sobre `(category, year, month, is_test)` y no un insert seguido
 * de un update: la restricción única de la tabla es la que garantiza «una meta
 * por categoría y mes», así que dejar que la resuelva PostgreSQL evita la
 * carrera de comprobar-y-luego-escribir y, de paso, hace que guardar dos veces
 * la misma meta sea inofensivo.
 */
export async function saveGoal(formData: FormData): Promise<ActionResult> {
  const denied = await requireSession();
  if (denied) return denied;

  const parsed = parseGoalForm(formData);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Falta la configuración de Supabase." };
  }

  const record = toGoalRecord(parsed.data);

  try {
    const { error } = await getSupabaseAdmin()
      .from("category_goals")
      .upsert(
        { ...record, is_test: shouldMarkAsTest() },
        { onConflict: "category,year,month,is_test" },
      );

    if (error) {
      // No debería ocurrir con el `onConflict` puesto, pero si la restricción
      // cambiara de forma, esto lo cuenta en cristiano en vez de soltar el
      // mensaje crudo de PostgreSQL.
      if (error.code === PG_UNIQUE_VIOLATION) {
        return { ok: false, message: "Ya existe una meta para esa categoría en ese mes." };
      }
      throw new Error(error.message);
    }

    logger.info("action.goal.saved", {
      category: record.category,
      year: record.year,
      month: record.month,
      amount: record.amount,
    });

    revalidateGoals();
    return { ok: true };
  } catch (error) {
    const message = describeError(error);
    logger.error("action.goal.save_failed", { error: message });
    return { ok: false, message: "No se pudo guardar la meta." };
  }
}

/**
 * Elimina una meta. **Aquí sí se borra la fila.**
 *
 * A diferencia de un movimiento, una meta no es un hecho histórico: es una
 * intención del usuario para un mes. No hay nada que auditar ni que restaurar,
 * así que una baja lógica solo añadiría una columna y una pantalla de papelera
 * que nadie visitaría. Los MOVIMIENTOS siguen intactos: borrar la meta de
 * Supermercado no toca ni un gasto de Supermercado.
 */
export async function deleteGoal(goalId: string): Promise<ActionResult> {
  const denied = await requireSession();
  if (denied) return denied;

  if (!UuidSchema.safeParse(goalId).success) {
    return { ok: false, message: "Meta no válida." };
  }

  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Falta la configuración de Supabase." };
  }

  try {
    const { error } = await getSupabaseAdmin()
      .from("category_goals")
      .delete()
      .eq("id", goalId);

    if (error) throw new Error(error.message);

    logger.info("action.goal.deleted", { goalId });

    revalidateGoals();
    return { ok: true };
  } catch (error) {
    const message = describeError(error);
    logger.error("action.goal.delete_failed", { goalId, error: message });
    return { ok: false, message: "No se pudo eliminar la meta." };
  }
}
