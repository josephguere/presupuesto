"use client";

import { useState, useTransition } from "react";
import { createMovement, updateMovement } from "@/app/actions";
import { NO_CATEGORY, getGroupForCategory } from "@/lib/categories";
import { CategoryCombobox, FORM_CATEGORY_OPTIONS } from "./CategoryCombobox";
import { DEFAULT_OPERATION_TYPE, OPERATION_TYPES } from "@/lib/operationTypes";
import { toDateInputValue, toTimeInputValue } from "@/lib/format";
import type { Transaction } from "@/types/transaction";

/**
 * Formulario de movimiento, para crear y para editar.
 *
 * Un único componente para los dos casos porque los campos son idénticos; lo
 * único que cambia es a qué Server Action se envía y con qué valores arranca.
 * Duplicarlo garantizaría que un día se añada un campo a uno y no al otro.
 *
 * Vive separado del diálogo que lo abre para poder renderizarlo en las pruebas
 * sin simular la apertura del modal ni el router de Next.
 *
 * CATEGORÍA Y GRUPO. La categoría es el único de los dos que se elige. El grupo
 * se DERIVA de ella en cada render con `getGroupForCategory`, se pinta bloqueado
 * y —esto es lo que de verdad lo cierra— no lleva atributo `name`, así que no
 * viaja en el `FormData`. Aunque alguien lo inyectara a mano, el servidor lo
 * ignora: `parseMovementForm` ni siquiera lee ese campo.
 *
 * Lo que NO aparece aquí, a propósito:
 *
 *   · Moneda — los movimientos manuales son siempre en soles.
 *   · Origen — MANUAL al crear; al editar no se toca nunca.
 *
 * La validación de este formulario es una comodidad, no una defensa: las mismas
 * reglas se aplican otra vez en la Server Action, que es la que manda.
 */
export function MovementForm({
  transaction,
  onSaved,
  onCancel,
}: {
  /** Presente = editar. Ausente = crear. */
  transaction?: Transaction;
  /** Se llama tras guardar con éxito. */
  onSaved: () => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(transaction);

  // Único estado del formulario: el resto de campos son no controlados. La
  // categoría lo es porque el grupo tiene que repintarse en cuanto cambie.
  const [category, setCategory] = useState<string>(transaction?.category ?? NO_CATEGORY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const group = getGroupForCategory(category === NO_CATEGORY ? null : category);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = transaction
        ? await updateMovement(transaction.id, formData)
        : await createMovement(formData);

      if (result.ok) {
        onSaved();
        return;
      }

      setMessage(result.message);
      setFieldErrors(result.fieldErrors ?? {});
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-4 shadow-xl sm:p-5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h2 className="text-lg font-semibold tracking-tight">
        {isEdit ? "Editar movimiento" : "Nuevo movimiento"}
      </h2>

      {isEdit && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Origen {transaction?.origin} · no se puede cambiar
        </p>
      )}

      {/* `min-w-0` en las celdas: sin él, un desplegable con una opción larga
          («Consumo Tarjeta de Débito») fija el ancho mínimo de la columna y el
          formulario desborda la pantalla del móvil. */}
      <div className="mt-4 grid grid-cols-2 gap-3 [&>*]:min-w-0">
        <Field label="Fecha" error={fieldErrors.date}>
          <input
            type="date"
            name="date"
            required
            defaultValue={toDateInputValue(transaction?.transactionAt ?? null)}
            className={inputClass}
          />
        </Field>

        <Field label="Hora" error={fieldErrors.time}>
          <input
            type="time"
            name="time"
            required
            defaultValue={toTimeInputValue(transaction?.transactionAt ?? null)}
            className={inputClass}
          />
        </Field>

        <Field label="Movimiento" error={fieldErrors.merchant} wide>
          <input
            type="text"
            name="merchant"
            required
            maxLength={200}
            placeholder="PLAZA VEA, Sueldo, Netflix..."
            defaultValue={transaction?.merchant ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Categoría" error={fieldErrors.category}>
          <CategoryCombobox
            name="category"
            options={FORM_CATEGORY_OPTIONS}
            defaultValue={category}
            onChange={setCategory}
          />
        </Field>

        <Field label="Grupo" hint="lo decide la categoría">
          {/* Sin `name`: no se envía. El servidor lo deriva por su cuenta. */}
          <input
            type="text"
            readOnly
            disabled
            aria-label="Grupo del movimiento"
            value={group ?? "—"}
            className={`${inputClass} cursor-not-allowed bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400`}
          />
        </Field>

        <Field label="Tipo" error={fieldErrors.operationType}>
          <select
            name="operationType"
            defaultValue={transaction?.operationType ?? DEFAULT_OPERATION_TYPE}
            className={inputClass}
          >
            {/* Al editar, el tipo que trae el correo puede no estar en el
                catálogo; se añade para no perderlo al guardar. */}
            {transaction?.operationType &&
              !OPERATION_TYPES.includes(
                transaction.operationType as (typeof OPERATION_TYPES)[number],
              ) && <option value={transaction.operationType}>{transaction.operationType}</option>}
            {OPERATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Tarjeta" hint="opcional" error={fieldErrors.cardLast4}>
          {/* Sin `required` y sin `pattern`: hay movimientos que no salen de
              ninguna tarjeta —efectivo, Yape, transferencias, ingresos— y el
              campo tiene que poder quedarse vacío. Si se escribe algo, tiene
              que ser 4 dígitos, y de eso se encarga el esquema del servidor,
              que es quien manda. */}
          <input
            type="text"
            name="cardLast4"
            inputMode="numeric"
            maxLength={4}
            placeholder="Sin tarjeta"
            defaultValue={transaction?.cardLast4 ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Monto (S/)" error={fieldErrors.amount}>
          <input
            type="number"
            name="amount"
            required
            step="0.01"
            min="0.01"
            placeholder="0.00"
            defaultValue={transaction ? transaction.amount.toFixed(2) : ""}
            className={inputClass}
          />
        </Field>

        <Field label="N° de operación" error={fieldErrors.operationNumber} wide>
          <input
            type="text"
            name="operationNumber"
            maxLength={60}
            placeholder="Opcional"
            defaultValue={transaction?.operationNumber ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Comentario" error={fieldErrors.comment} wide>
          <textarea
            name="comment"
            rows={2}
            maxLength={500}
            placeholder="Opcional"
            defaultValue={transaction?.comment ?? ""}
            className={inputClass}
          />
        </Field>
      </div>

      {message && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {message}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isPending ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear movimiento"}
        </button>
      </div>
    </form>
  );
}

const inputClass =
  "w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 " +
  "dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50";

function Field({
  label,
  error,
  hint,
  wide,
  children,
}: {
  label: string;
  error?: string;
  /** Aclaración corta junto a la etiqueta, para campos que no se editan. */
  hint?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${wide ? "col-span-2" : ""}`}>
      <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        {label}
        {hint && <span className="ml-1 normal-case opacity-70">({hint})</span>}
      </span>
      {children}
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </label>
  );
}
