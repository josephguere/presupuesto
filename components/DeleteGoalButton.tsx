"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteGoal } from "@/app/goalActions";

/**
 * Elimina una meta, preguntando antes.
 *
 * Confirma en dos pasos y no con `window.confirm`: el diálogo del navegador
 * bloquea el hilo, se ve distinto en cada sistema y no se puede probar. Aquí el
 * botón se convierte en «¿Seguro?» y el usuario decide con el mismo dedo.
 *
 * Borrar una meta NO toca ningún movimiento: solo desaparece la cifra objetivo
 * de ese mes. Por eso no hay papelera ni restauración, a diferencia de los
 * movimientos.
 */
export function DeleteGoalButton({ goalId, label }: { goalId: string; label: string }) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteGoal(goalId);

      if (result.ok) {
        router.refresh();
        return;
      }

      setConfirming(false);
      setMessage(result.message);
    });
  }

  if (message) {
    return (
      <span role="alert" className="text-xs text-red-600 dark:text-red-400">
        {message}
      </span>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Eliminar la meta de ${label}`}
        className="text-sm font-medium text-zinc-500 transition-colors hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400"
      >
        Eliminar
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2 text-sm">
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        className="font-medium text-red-600 hover:underline disabled:opacity-60 dark:text-red-400"
      >
        {isPending ? "Eliminando..." : "¿Seguro?"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={isPending}
        className="text-zinc-500 hover:underline disabled:opacity-60 dark:text-zinc-400"
      >
        No
      </button>
    </span>
  );
}
