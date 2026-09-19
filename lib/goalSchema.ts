import { z } from "zod";
import { CATEGORIES, type Category } from "@/lib/categories";

/**
 * Validación de una meta de gasto.
 *
 * Vive aparte de las Server Actions para poder probarla sin base de datos y para
 * que el formulario y el backend compartan exactamente las mismas reglas, igual
 * que `lib/movementSchema.ts`.
 *
 * LA CATEGORÍA SE VALIDA CONTRA EL CATÁLOGO. Es un `enum`, no texto libre: una
 * meta sobre una categoría que no existe no casaría con ningún movimiento y
 * mostraría «S/ 0 gastado» para siempre, que parece un dato y no lo es.
 */

/** Mismo techo que el importe de un movimiento: `NUMERIC(12,2)`. */
const MAX_AMOUNT = 9_999_999_999.99;

export const GoalSchema = z.object({
  category: z.enum(CATEGORIES as [Category, ...Category[]]),

  /** `YYYY-MM`. Es como viaja el mes por toda la aplicación. */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "El mes debe tener formato AAAA-MM")
    .refine((value) => {
      const year = Number(value.slice(0, 4));
      return year >= 2000 && year <= 2100;
    }, "El año está fuera de rango"),

  amount: z.coerce
    .number({ message: "El monto debe ser un número" })
    .positive("La meta debe ser mayor que 0")
    .max(MAX_AMOUNT, "La meta es demasiado grande"),
});

export type GoalParsed = z.output<typeof GoalSchema>;

/** Lo que realmente se escribe en `category_goals`. */
export interface GoalRecord {
  category: Category;
  year: number;
  month: number;
  amount: number;
}

export function toGoalRecord(input: GoalParsed): GoalRecord {
  const [year, month] = input.month.split("-").map(Number);

  return {
    category: input.category,
    year,
    month,
    amount: Math.round(input.amount * 100) / 100,
  };
}

/** Lee un `FormData` y lo valida. */
export function parseGoalForm(formData: FormData) {
  return GoalSchema.safeParse({
    category: formData.get("category") ?? "",
    month: formData.get("month") ?? "",
    amount: formData.get("amount") ?? "",
  });
}
