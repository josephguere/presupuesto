"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

/**
 * Cuatro casillas para el PIN de acceso.
 *
 * Los dígitos van en `type="password"`: se ocultan mientras se escriben y el
 * navegador no los ofrece como autocompletado de un campo normal. Con
 * `inputMode="numeric"` el móvil abre el teclado de números directamente.
 *
 * El PIN vive en el estado de este componente y en el cuerpo de una petición.
 * No se guarda en `localStorage`, no viaja en la URL y no se registra en ningún
 * sitio; lo único que queda tras entrar es la cookie firmada, que el JavaScript
 * de la página ni siquiera puede leer.
 *
 * La validación de aquí es comodidad: bloquear el botón con menos de 4 dígitos
 * ahorra un viaje al servidor, pero quien decide es el endpoint.
 */

const LENGTH = 4;

export function PinForm({ next }: { next: string }) {
  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const router = useRouter();

  const pin = digits.join("");
  const complete = pin.length === LENGTH;

  function focusBox(index: number) {
    inputs.current[Math.min(Math.max(index, 0), LENGTH - 1)]?.focus();
  }

  /** Escribe una secuencia a partir de una casilla. Sirve para teclear y pegar. */
  function write(start: number, value: string) {
    const incoming = value.replace(/\D/g, "").slice(0, LENGTH - start);
    if (incoming.length === 0) return;

    setError(null);
    setDigits((current) => {
      const updated = [...current];
      for (let i = 0; i < incoming.length; i += 1) updated[start + i] = incoming[i];
      return updated;
    });

    focusBox(start + incoming.length);
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace") {
      event.preventDefault();
      setError(null);
      setDigits((current) => {
        const updated = [...current];
        // Si la casilla ya está vacía, se borra la anterior y se retrocede.
        if (updated[index] === "" && index > 0) {
          updated[index - 1] = "";
          focusBox(index - 1);
        } else {
          updated[index] = "";
        }
        return updated;
      });
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusBox(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focusBox(index + 1);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!complete || isPending) return;

    startTransition(async () => {
      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin }),
        });

        const result = (await response.json()) as { ok: boolean; message?: string };

        if (result.ok) {
          // `replace` para que el botón atrás no vuelva a la pantalla de acceso.
          router.replace(next);
          router.refresh();
          return;
        }

        setError(result.message ?? "Código incorrecto");
        setDigits(Array(LENGTH).fill(""));
        focusBox(0);
      } catch {
        setError("No se pudo conectar. Revisa tu conexión.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col items-center gap-6">
      <div className="flex justify-center gap-2 sm:gap-3">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(element) => {
              inputs.current[index] = element;
            }}
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label={`Dígito ${index + 1} de ${LENGTH}`}
            maxLength={1}
            value={digit}
            autoFocus={index === 0}
            disabled={isPending}
            onChange={(event) => write(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onPaste={(event) => {
              // Pegar los 4 de golpe reparte los dígitos entre las casillas.
              event.preventDefault();
              write(index, event.clipboardData.getData("text"));
            }}
            onFocus={(event) => event.target.select()}
            className={`h-14 w-12 rounded-xl border text-center text-2xl tabular-nums transition-colors disabled:opacity-60 sm:h-16 sm:w-14 ${
              error
                ? "border-red-400 dark:border-red-800"
                : "border-zinc-300 focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
            } bg-white text-zinc-900 outline-none dark:bg-zinc-950 dark:text-zinc-50`}
          />
        ))}
      </div>

      {/* Altura reservada: el mensaje no debe empujar el botón al aparecer. */}
      <p role="alert" aria-live="polite" className="min-h-5 text-sm text-red-600 dark:text-red-400">
        {error}
      </p>

      <button
        type="submit"
        disabled={!complete || isPending}
        className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? "Verificando..." : "Entrar"}
      </button>
    </form>
  );
}
