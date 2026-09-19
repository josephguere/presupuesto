"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { purgeMovement } from "@/app/actions";

/**
 * Botón de «Eliminar para siempre», solo en la papelera.
 *
 * Es la única acción destructiva de verdad de toda la aplicación: todo lo demás
 * —incluido el botón «Eliminar» de Movimientos— es baja lógica y se puede
 * deshacer. Por eso la confirmación no se parece a las otras:
 *
 *   · Dice explícitamente que NO se puede deshacer.
 *   · Nombra el movimiento y su importe, para que se vea qué se va a destruir.
 *   · Es `confirm()` nativo, igual que restaurar y eliminar. Un modal propio
 *     aquí tendría que resolver foco, Escape y lectores de pantalla por su
 *     cuenta, y este es justo el diálogo que peor puede salir mal.
 *
 * El botón va en rojo y no como enlace: es la diferencia visible con
 * «Restaurar», que está al lado y hace lo contrario.
 */
export function PurgeMovementButton({
  transactionId,
  label,
  amount,
}: {
  transactionId: string;
  /** Nombre del movimiento, para que la pregunta diga cuál se va a borrar. */
  label: string;
  /** Importe ya formateado. Ayuda a reconocerlo antes de destruirlo. */
  amount: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    const confirmed = confirm(
      `¿Estás seguro de eliminar este movimiento para siempre?\n\n` +
        `${label} · ${amount}\n\n` +
        `Esta acción no se puede deshacer.`,
    );

    if (!confirmed) return;

    setError(null);
    startTransition(async () => {
      const result = await purgeMovement(transactionId);
      // Al desaparecer la fila, `router.refresh()` la quita de la papelera con
      // datos del servidor, no con estado local.
      if (result.ok) router.refresh();
      else setError(result.message);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-label={`Eliminar para siempre ${label}`}
      title={error ?? undefined}
      className={`text-xs font-medium transition-colors disabled:opacity-50 ${
        error
          ? "text-red-700 underline dark:text-red-400"
          : "text-red-600 hover:underline dark:text-red-400"
      }`}
    >
      {isPending ? "Eliminando..." : "Eliminar para siempre"}
    </button>
  );
}
