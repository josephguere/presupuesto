"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { saveGoal } from "@/app/goalActions";
import { CategoryCombobox, type CategoryOption } from "./CategoryCombobox";
import { CATEGORIES } from "@/lib/categories";
import { formatMonthLabel } from "@/lib/format";
import type { CategoryGoal } from "@/lib/goals";

/**
 * Diálogo para crear o editar una meta.
 *
 * Mismo patrón que `MovementDialog`: el diálogo monta el formulario solo cuando
 * está abierto y lo desmonta al cerrar, así que el ciclo de vida del componente
 * ES la apertura y no hace falta reiniciar campos a mano.
 *
 * Un solo componente para crear y editar porque los campos son idénticos. Lo
 * único que cambia es con qué valores arranca y si la categoría se puede tocar:
 * al editar queda fija, porque cambiarla no sería editar esta meta sino crear
 * otra y dejar la primera huérfana.
 *
 * `z-50`, igual que `MovementDialog`, para quedar por encima de la cabecera.
 */
export function GoalDialog({
  goal,
  month,
  trigger,
  usedCategories,
}: {
  /** Presente = editar. Ausente = crear. */
  goal?: CategoryGoal;
  /** Mes al que se añade la meta nueva. */
  month: string;
  trigger: "primary" | "link";
  /** Categorías que ya tienen meta este mes: no se ofrecen dos veces. */
  usedCategories: string[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  // Escape cierra, como en cualquier diálogo.
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          trigger === "primary"
            ? "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            : "text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        }
      >
        {trigger === "primary" ? "Nueva meta" : "Editar"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/50 p-3 sm:p-6"
          // Cerrar al pulsar fuera, como en MovementDialog. La comprobación de
          // que el clic fue en el velo y no dentro del formulario evita cerrar
          // al soltar el ratón tras seleccionar texto.
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <GoalForm
            goal={goal}
            month={month}
            usedCategories={usedCategories}
            onSaved={() => {
              setOpen(false);
              router.refresh();
            }}
            onCancel={() => setOpen(false)}
          />
        </div>
      )}
    </>
  );
}

/**
 * El formulario en sí.
 *
 * Separado del diálogo para poder renderizarlo en las pruebas sin simular la
 * apertura del modal ni el router de Next, igual que `MovementForm`.
 */
export function GoalForm({
  goal,
  month,
  usedCategories,
  onSaved,
  onCancel,
}: {
  goal?: CategoryGoal;
  month: string;
  usedCategories: string[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(goal);

  const [category, setCategory] = useState<string>(goal?.category ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  // Al crear no se ofrecen las categorías que ya tienen meta este mes: guardarla
  // otra vez pisaría la anterior sin avisar, y el usuario creería que ha creado
  // una segunda.
  const options = availableCategories(isEdit ? [] : usedCategories, goal?.category);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await saveGoal(formData);

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
      className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-xl sm:p-5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h2 className="text-lg font-semibold tracking-tight">
        {isEdit ? "Editar meta" : "Nueva meta"}
      </h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {formatMonthLabel(goal?.month ?? month)}
      </p>

      {/* El mes NO se elige aquí: es el que se está viendo. Cambiarlo desde el
          formulario movería la meta a un mes que no está en pantalla y parecería
          que se ha perdido. Para otro mes, se cambia arriba y se crea allí. */}
      <input type="hidden" name="month" value={goal?.month ?? month} />

      <div className="mt-4 space-y-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Categoría
            {isEdit && <span className="ml-1 normal-case opacity-70">(no se puede cambiar)</span>}
          </span>

          {isEdit ? (
            <>
              {/* Fija al editar: cambiarla no sería editar esta meta, sino
                  crear otra. El valor viaja igual en un campo oculto. */}
              <input type="hidden" name="category" value={goal!.category} />
              <input
                type="text"
                readOnly
                disabled
                value={goal!.category}
                aria-label="Categoría de la meta"
                className={`${inputClass} cursor-not-allowed bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400`}
              />
            </>
          ) : (
            <CategoryCombobox
              name="category"
              options={options}
              value={category}
              onChange={setCategory}
              ariaLabel="Categoría de la meta"
              placeholder="Escribe para buscar..."
            />
          )}

          {fieldErrors.category && (
            <span className="text-xs text-red-600 dark:text-red-400">{fieldErrors.category}</span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Meta mensual (S/)
          </span>
          <input
            type="number"
            name="amount"
            required
            step="0.01"
            min="0.01"
            placeholder="0.00"
            defaultValue={goal ? goal.amount.toFixed(2) : ""}
            className={inputClass}
          />
          {fieldErrors.amount && (
            <span className="text-xs text-red-600 dark:text-red-400">{fieldErrors.amount}</span>
          )}
        </label>
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
          {isPending ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear meta"}
        </button>
      </div>
    </form>
  );
}

/**
 * Categorías que se pueden elegir.
 *
 * Se quitan las que ya tienen meta este mes. La de la meta que se edita sí
 * aparece, o el combo arrancaría vacío.
 *
 * Está fuera del componente para poder probarla sin renderizar el formulario.
 */
export function availableCategories(used: string[], keep?: string): CategoryOption[] {
  return CATEGORIES.filter((category) => category === keep || !used.includes(category)).map(
    (category) => ({ value: category, label: category }),
  );
}

const inputClass =
  "w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 " +
  "dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50";
