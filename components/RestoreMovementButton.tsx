"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { restoreMovement } from "@/app/actions";

/**
 * Botón de restaurar, con confirmación.
 *
 * Mismo planteamiento que el de eliminar: `confirm()` nativo en vez de un modal
 * propio —una sola pregunta, accesible por defecto— y `router.refresh()` al
 * terminar, para que el movimiento desaparezca de la papelera y reaparezca en
 * Movimientos y en los indicadores con datos del servidor, no con estado local.
 */
export function RestoreMovementButton({
  transactionId,
  label,
}: {
  transactionId: string;
  /** Nombre del movimiento, para que la pregunta diga cuál se va a restaurar. */
  label: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    if (!confirm("¿Deseas restaurar este movimiento?")) return;

    setError(null);
    startTransition(async () => {
      const result = await restoreMovement(transactionId);
      if (result.ok) router.refresh();
      else setError(result.message);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-label={`Restaurar ${label}`}
      title={error ?? undefined}
      className={`text-xs font-medium transition-colors disabled:opacity-50 ${
        error
          ? "text-red-700 underline dark:text-red-400"
          : "text-blue-600 hover:underline dark:text-blue-400"
      }`}
    >
      {isPending ? "Restaurando..." : "Restaurar"}
    </button>
  );
}
