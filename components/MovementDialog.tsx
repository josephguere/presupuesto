"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MovementForm } from "./MovementForm";
import type { Transaction } from "@/types/transaction";

/**
 * Botón + modal que envuelven al formulario de movimiento.
 *
 * Aquí solo vive lo que rodea al formulario: abrir, cerrar y refrescar. El
 * formulario en sí está en `MovementForm`, que no sabe nada del modal y por eso
 * puede probarse por separado.
 *
 * Al guardar, `router.refresh()` vuelve a pedir la página al servidor, así que
 * tabla, resumen e indicadores se actualizan a la vez y con datos reales.
 */
export function MovementDialog({
  transaction,
  trigger,
}: {
  /** Presente = editar. Ausente = crear. */
  transaction?: Transaction;
  /** Cómo se ve el botón que abre el formulario. */
  trigger: "primary" | "link";
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const isEdit = Boolean(transaction);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          trigger === "primary"
            ? "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            : "text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        }
      >
        {isEdit ? "Editar" : "+ Nuevo movimiento"}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={isEdit ? "Editar movimiento" : "Nuevo movimiento"}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/50 p-4 sm:items-center"
          onMouseDown={(event) => {
            // Cerrar al pulsar fuera, pero no al arrastrar desde dentro.
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          {/* Al cerrar, el formulario se desmonta: los valores a medio escribir
              y los errores del intento anterior no sobreviven a la reapertura. */}
          <MovementForm
            transaction={transaction}
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
