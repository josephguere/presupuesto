"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { CATEGORIES, NO_CATEGORY } from "@/lib/categories";
import { describeError, logger } from "@/lib/logger";

/**
 * Server Actions del dashboard.
 *
 * SEGURIDAD: una Server Action es un endpoint público. Cualquiera que pueda
 * cargar la página puede invocarla, y estas escriben con la `service_role` key,
 * que se salta el RLS. Por eso todo lo que llega se valida contra un esquema
 * cerrado antes de tocar la base de datos:
 *
 *   · el id tiene que ser un UUID;
 *   · la categoría, una de la lista — nunca texto libre del cliente.
 *
 * Así lo peor que puede hacer alguien es cambiar la categoría de una transacción
 * suya a otra categoría válida. No hay inyección ni escritura arbitraria.
 */

const UpdateCategorySchema = z.object({
  transactionId: z.string().uuid(),
  // Lista cerrada, más el centinela de "sin categoría".
  category: z.enum([...CATEGORIES, NO_CATEGORY] as [string, ...string[]]),
});

export type ActionResult = { ok: true } | { ok: false; message: string };

/**
 * Asigna (o quita) la categoría de un movimiento.
 *
 * @param transactionId UUID de la transacción.
 * @param category Una de `CATEGORIES`, o `NO_CATEGORY` para dejarla sin asignar.
 */
export async function updateTransactionCategory(
  transactionId: string,
  category: string,
): Promise<ActionResult> {
  const parsed = UpdateCategorySchema.safeParse({ transactionId, category });

  if (!parsed.success) {
    logger.warn("action.category.invalid_input");
    return { ok: false, message: "Categoría o movimiento no válidos." };
  }

  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Falta la configuración de Supabase." };
  }

  // El centinela se traduce aquí: en la base de datos, "sin categoría" es NULL.
  const stored = parsed.data.category === NO_CATEGORY ? null : parsed.data.category;

  try {
    const { error } = await getSupabaseAdmin()
      .from("transactions")
      .update({ category: stored })
      .eq("id", parsed.data.transactionId);

    if (error) throw new Error(error.message);

    logger.info("action.category.updated", {
      transactionId: parsed.data.transactionId,
      category: stored,
    });

    // Ambas vistas muestran categorías: hay que refrescar las dos.
    revalidatePath("/");
    revalidatePath("/movimientos");

    return { ok: true };
  } catch (error) {
    const message = describeError(error);
    logger.error("action.category.failed", {
      transactionId: parsed.data.transactionId,
      error: message,
    });
    return { ok: false, message: "No se pudo guardar la categoría." };
  }
}
