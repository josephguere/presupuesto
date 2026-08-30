"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { parseMovementForm, resolveGroup, toFieldErrors, toMovementRecord } from "@/lib/movementSchema";
import { shouldMarkAsTest } from "@/lib/environment";
import { SESSION_REQUIRED_MESSAGE, hasValidSession } from "@/lib/auth/guard";
import { describeError, logger } from "@/lib/logger";

/**
 * Server Actions del dashboard: crear, editar, eliminar y restaurar.
 *
 * SEGURIDAD. Una Server Action es un endpoint público: cualquiera que pueda
 * cargar la página puede invocarla, y estas escriben con la `service_role` key,
 * que se salta el RLS. Por eso todo lo que llega se valida contra un esquema
 * cerrado antes de tocar la base de datos.
 *
 * Dos invariantes que se sostienen aquí, no en el navegador:
 *
 *   · El GRUPO se deriva de la categoría en el servidor. Nunca se acepta del
 *     formulario, para que nadie pueda meter un gasto dentro de INGRESOS.
 *   · El ORIGEN no es editable. Un movimiento creado desde el formulario nace
 *     como MANUAL y uno que vino de un correo sigue siendo EMAIL para siempre.
 *
 * Eliminar es una BAJA LÓGICA: la fila nunca se borra, solo se desactiva. Ver
 * `deleteMovement`.
 *
 * SESIÓN. Todas comprueban la cookie antes de escribir. El proxy ya redirige
 * al login a quien navegue sin sesión, pero eso decide lo que se VE; una Server
 * Action se puede invocar directamente conociendo su identificador, así que la
 * autorización tiene que estar aquí, junto al UPDATE.
 */

export type ActionResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

const UuidSchema = z.string().uuid();

/**
 * Las tres vistas muestran movimientos, así que cualquier escritura las afecta.
 *
 * Eliminar y restaurar mueven una fila de «Movimientos» a «Eliminados» y al
 * revés; refrescarlas por separado dejaría una de las dos mintiendo.
 */
function revalidateViews(): void {
  revalidatePath("/");
  revalidatePath("/movimientos");
  revalidatePath("/eliminados");
}

/**
 * Corta la acción si no hay sesión.
 *
 * Devuelve el mismo resultado que cualquier otro fallo de la acción, para que la
 * interfaz lo muestre sin ramas especiales.
 */
async function requireSession(): Promise<ActionResult | null> {
  if (await hasValidSession()) return null;

  logger.warn("action.unauthorized");
  return { ok: false, message: SESSION_REQUIRED_MESSAGE };
}

/* -------------------------------------------------------------------------- */
/* Crear                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Crea un movimiento manual.
 *
 * `origin = MANUAL` y `email_ingestion_id = NULL`: no viene de ningún correo.
 * El importe siempre es en soles, así que no hay conversión ni selector de
 * moneda.
 */
export async function createMovement(formData: FormData): Promise<ActionResult> {
  const denied = await requireSession();
  if (denied) return denied;

  const parsed = parseMovementForm(formData);

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

  const record = toMovementRecord(parsed.data);

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("transactions")
      .insert({
        ...record,
        email_ingestion_id: null,
        bank: null,
        currency: "PEN",
        origin: "MANUAL",
        source: "MANUAL",
        is_test: shouldMarkAsTest(),
      })
      .select("id")
      .single<{ id: string }>();

    if (error) throw new Error(error.message);

    logger.info("action.movement.created", {
      transactionId: data.id,
      category: record.category,
      // El grupo se registra por trazabilidad; no se guarda como columna.
      group: resolveGroup(parsed.data),
    });

    revalidateViews();
    return { ok: true };
  } catch (error) {
    const message = describeError(error);
    logger.error("action.movement.create_failed", { error: message });
    return { ok: false, message: "No se pudo crear el movimiento." };
  }
}

/* -------------------------------------------------------------------------- */
/* Editar                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Actualiza un movimiento existente. Nunca crea uno nuevo.
 *
 * No se toca `origin`, `email_ingestion_id` ni la trazabilidad de divisa: editar
 * un movimiento que llegó por correo no lo convierte en manual ni borra de dónde
 * salió su importe.
 */
export async function updateMovement(
  transactionId: string,
  formData: FormData,
): Promise<ActionResult> {
  const denied = await requireSession();
  if (denied) return denied;

  if (!UuidSchema.safeParse(transactionId).success) {
    return { ok: false, message: "Movimiento no válido." };
  }

  const parsed = parseMovementForm(formData);
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

  try {
    const { error } = await getSupabaseAdmin()
      .from("transactions")
      .update(toMovementRecord(parsed.data))
      .eq("id", transactionId);

    if (error) throw new Error(error.message);

    logger.info("action.movement.updated", {
      transactionId,
      category: parsed.data.category,
      group: resolveGroup(parsed.data),
    });

    revalidateViews();
    return { ok: true };
  } catch (error) {
    const message = describeError(error);
    logger.error("action.movement.update_failed", { transactionId, error: message });
    return { ok: false, message: "No se pudo guardar el movimiento." };
  }
}

/* -------------------------------------------------------------------------- */
/* Eliminar y restaurar                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Da de baja un movimiento. **No lo borra.**
 *
 * `activo = false` y `eliminado_at = ahora`. La fila permanece en la tabla con
 * su id, su correo de origen y su trazabilidad de divisa intactos, y todas las
 * consultas del dashboard la excluyen por el filtro de `activo`.
 *
 * Que no se borre es lo que hace posible «Restaurar» sin recrear nada, y de paso
 * mantiene la idempotencia de la ingesta: el correo que originó el movimiento
 * sigue teniendo su transacción asociada, así que reprocesarlo responde
 * ALREADY_PROCESSED en vez de crear un duplicado.
 */
export async function deleteMovement(transactionId: string): Promise<ActionResult> {
  return setActive(transactionId, false);
}

/**
 * Reactiva un movimiento dado de baja.
 *
 * Es un UPDATE sobre la MISMA fila: mismo id, misma fecha, mismo importe. No se
 * inserta nada, así que el movimiento vuelve a los listados y a los indicadores
 * exactamente como estaba.
 */
export async function restoreMovement(transactionId: string): Promise<ActionResult> {
  return setActive(transactionId, true);
}

/**
 * Motor común de baja y alta lógica.
 *
 * Los dos campos se escriben SIEMPRE juntos, en la misma sentencia, porque la
 * base de datos tiene un CHECK que exige que concuerden: activo sin fecha, o
 * inactivo con ella. Nunca puede quedar un estado a medias.
 */
async function setActive(transactionId: string, activo: boolean): Promise<ActionResult> {
  const denied = await requireSession();
  if (denied) return denied;

  if (!UuidSchema.safeParse(transactionId).success) {
    return { ok: false, message: "Movimiento no válido." };
  }

  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Falta la configuración de Supabase." };
  }

  const accion = activo ? "restaurar" : "eliminar";

  try {
    const { error } = await getSupabaseAdmin()
      .from("transactions")
      .update({ activo, eliminado_at: activo ? null : new Date().toISOString() })
      .eq("id", transactionId);

    if (error) throw new Error(error.message);

    logger.info(activo ? "action.movement.restored" : "action.movement.deleted", {
      transactionId,
    });

    revalidateViews();
    return { ok: true };
  } catch (error) {
    const message = describeError(error);
    logger.error(`action.movement.${accion}_failed`, { transactionId, error: message });
    return { ok: false, message: `No se pudo ${accion} el movimiento.` };
  }
}
