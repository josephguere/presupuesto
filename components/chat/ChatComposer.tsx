"use client";

import { useState, type RefObject } from "react";
import { MAX_QUESTION_LENGTH, MIN_QUESTION_LENGTH } from "@/lib/ai/limits";

/**
 * El cuadro de escribir y el botón de enviar.
 *
 * UN `<form onSubmit>` DE VERDAD, no un `onClick` en el botón: así el Enter del
 * teclado y el clic pasan por el MISMO embudo. Con dos caminos separados siempre
 * acaba habiendo uno que se olvidó de comprobar algo — aquí, el doble envío.
 *
 * Shift+Enter salta de línea, que es lo que todo el mundo espera de un chat.
 *
 * `maxLength` sale de `lib/ai/limits.ts`, el MISMO número que valida zod en el
 * servidor. Así el corte se ve al escribir en lugar de aparecer como un error
 * después de haber enviado.
 */
export function ChatComposer({
  pending,
  onSend,
  inputRef,
}: {
  pending: boolean;
  onSend: (question: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [draft, setDraft] = useState("");

  const listo = draft.trim().length >= MIN_QUESTION_LENGTH;

  function submit() {
    // La misma condición que deshabilita el botón, comprobada otra vez: el
    // Enter no mira si el botón está deshabilitado.
    if (pending || !listo) return;

    onSend(draft.trim());
    setDraft("");

    // El alto se puso a mano al escribir, así que hay que devolverlo a mano.
    if (inputRef.current) inputRef.current.style.height = "auto";
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      // El hueco inferior respeta la zona segura del iPhone: sin esto, el botón
      // queda debajo de la barra de gestos.
      className="flex items-end gap-2 border-t border-zinc-200 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] dark:border-zinc-800"
    >
      <label className="sr-only" htmlFor="chat-pregunta">
        Escribe tu pregunta
      </label>

      <textarea
        id="chat-pregunta"
        ref={inputRef}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          // Crece con lo escrito hasta el tope de `max-h-28`, y entonces se
          // desplaza. Sin esto, una pregunta de quinientos caracteres se edita
          // por una rendija de una línea: se puede escribir, pero no releer.
          //
          // Va en el `onChange` y no en un efecto a propósito: la regla
          // `react-hooks/set-state-in-effect` prohíbe el otro camino, y aquí el
          // alto solo depende de lo que se acaba de teclear.
          const campo = event.currentTarget;
          campo.style.height = "auto";
          campo.style.height = `${campo.scrollHeight}px`;
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        rows={1}
        maxLength={MAX_QUESTION_LENGTH}
        placeholder="¿Cuánto gasté este mes?"
        disabled={pending}
        className="max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
      />

      <button
        type="submit"
        disabled={pending || !listo}
        className="shrink-0 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {/* Mismo idioma que «Guardando...» en el formulario de movimiento. */}
        {pending ? "Consultando…" : "Enviar"}
      </button>
    </form>
  );
}
