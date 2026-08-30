import { z } from "zod";
import { CATEGORIES, NO_CATEGORY, getGroupForCategory, type Category } from "@/lib/categories";
import { isValidOperationType } from "@/lib/operationTypes";
import type { Group } from "@/lib/categories";

/**
 * Validación de un movimiento manual.
 *
 * Vive aparte de las Server Actions para poder probarla sin base de datos y
 * para que el formulario y el backend compartan exactamente las mismas reglas.
 *
 * REGLA CLAVE: el GRUPO no se acepta del cliente. Llegue lo que llegue en el
 * formulario, se deriva de la categoría con `getGroupForCategory`. Un cliente no
 * puede colocar «Restaurantes» dentro de INGRESOS y falsear el balance.
 */

/** Máximo aceptable: `NUMERIC(12,2)` con dos decimales. */
const MAX_AMOUNT = 9_999_999_999.99;

export const MovementSchema = z.object({
  /** `YYYY-MM-DD`. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener formato AAAA-MM-DD")
    .refine((value) => isRealDate(value), "La fecha no existe"),

  /** `HH:MM`, 24 horas. */
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "La hora debe tener formato HH:MM (24 horas)"),

  /** «Movimiento» en la interfaz; `merchant` en la base de datos. */
  merchant: z.string().trim().min(1, "El movimiento es obligatorio").max(200),

  category: z
    .union([z.enum(CATEGORIES as [Category, ...Category[]]), z.literal(NO_CATEGORY)])
    .default(NO_CATEGORY),

  operationType: z
    .string()
    .trim()
    .refine(isValidOperationType, "Tipo de operación no válido"),

  /** Cuatro dígitos, o vacío. */
  cardLast4: z
    .string()
    .trim()
    .max(4)
    .refine((value) => value === "" || /^\d{4}$/.test(value), "La tarjeta debe ser 4 dígitos")
    .default(""),

  /** Siempre en soles: los movimientos manuales no admiten otra moneda. */
  amount: z.coerce
    .number({ message: "El monto debe ser un número" })
    .positive("El monto debe ser mayor que 0")
    .max(MAX_AMOUNT, "El monto es demasiado grande"),

  operationNumber: z.string().trim().max(60).default(""),
  comment: z.string().trim().max(500).default(""),
});

export type MovementInput = z.input<typeof MovementSchema>;
export type MovementParsed = z.output<typeof MovementSchema>;

/** Lo que realmente se escribe en `transactions`. */
export interface MovementRecord {
  transaction_at: string;
  merchant: string;
  category: Category | null;
  operation_type: string;
  card_last4: string | null;
  amount: number;
  operation_number: string | null;
  comment: string | null;
}

/**
 * Traduce un formulario validado a columnas.
 *
 * La fecha y la hora se combinan con el offset de Lima. Perú es UTC−05:00 todo
 * el año, así que no hace falta librería de zonas horarias.
 */
export function toMovementRecord(input: MovementParsed): MovementRecord {
  const category = input.category === NO_CATEGORY ? null : input.category;

  return {
    transaction_at: `${input.date}T${input.time}:00-05:00`,
    merchant: input.merchant,
    category,
    operation_type: input.operationType,
    card_last4: input.cardLast4 === "" ? null : input.cardLast4,
    amount: Math.round(input.amount * 100) / 100,
    operation_number: input.operationNumber === "" ? null : input.operationNumber,
    comment: input.comment === "" ? null : input.comment,
  };
}

/**
 * Grupo que corresponde a un movimiento validado.
 *
 * Se calcula siempre en el servidor. Existe como función aparte para que las
 * pruebas puedan comprobar la derivación sin pasar por la base de datos.
 */
export function resolveGroup(input: MovementParsed): Group | null {
  return getGroupForCategory(input.category === NO_CATEGORY ? null : input.category);
}

/** Lee un `FormData` y lo valida. */
export function parseMovementForm(formData: FormData) {
  return MovementSchema.safeParse({
    date: formData.get("date") ?? "",
    time: formData.get("time") ?? "",
    merchant: formData.get("merchant") ?? "",
    category: formData.get("category") ?? NO_CATEGORY,
    operationType: formData.get("operationType") ?? "",
    cardLast4: formData.get("cardLast4") ?? "",
    amount: formData.get("amount") ?? "",
    operationNumber: formData.get("operationNumber") ?? "",
    comment: formData.get("comment") ?? "",
  });
}

/** Convierte los errores de Zod en `{ campo: mensaje }` para el formulario. */
export function toFieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    errors[field] ??= issue.message;
  }
  return errors;
}

/** `2026-02-31` tiene formato válido pero no existe. */
function isRealDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= lastDay && year >= 2000 && year <= 2100;
}
