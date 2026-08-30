"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteMovement } from "@/app/actions";

/**
 * Botón de eliminar, con confirmación.
 *
 * Usa el `confirm()` nativo del navegador en lugar de un modal propio: es una
 * sola pregunta, es accesible por defecto y no se puede pulsar por accidente.
 * Un diálogo a medida aquí sería más código para exactamente el mismo resultado.
 *
 * Al eliminar, `router.refresh()` vuelve a pedir la página al servidor, así que
 * tabla, resumen e indicadores se actualizan juntos y con datos reales — no con
 * un estado local que podría discrepar de la base de datos.
 *
 * La baja es LÓGICA: el movimiento se desactiva y pasa a «Eliminados», desde
 * donde puede restaurarse. Nada se borra de la base de datos.
 */
export function DeleteMovementButton({
  transactionId,
  label,
}: {
  transactionId: string;
  /** Nombre del movimiento, para que la pregunta diga qué se va a borrar. */
  label: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    if (!confirm("¿Seguro que deseas eliminar este movimiento?")) return;

    setError(null);
    startTransition(async () => {
      const result = await deleteMovement(transactionId);
      if (result.ok) router.refresh();
      else setError(result.message);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-label={`Eliminar ${label}`}
      title={error ?? undefined}
      className={`text-xs font-medium transition-colors disabled:opacity-50 ${
        error
          ? "text-red-700 underline dark:text-red-400"
          : "text-red-600 hover:underline dark:text-red-400"
      }`}
    >
      {isPending ? "Eliminando..." : "Eliminar"}
    </button>
  );
}
