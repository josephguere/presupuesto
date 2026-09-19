"use client";

import type { RefObject } from "react";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageList } from "./ChatMessageList";
import type { ChatMessageItem } from "@/lib/chat/types";

/**
 * La carcasa del chat: cabecera, lista, cuadro de escribir.
 *
 * SIN ESTADO PROPIO. Todo llega por props, y eso es lo que permite renderizarlo
 * en las pruebas con `renderToStaticMarkup` —el entorno de Vitest es `node`, no
 * hay jsdom— y comprobar el marcado de cada estado sin router ni `fetch`.
 *
 * NO ES UN MODAL, y es una decisión, no un olvido: sin velo oscuro, sin
 * `aria-modal`, sin trampa de foco y sin cierre al pulsar fuera. Un modal
 * INUTILIZA lo que hay detrás, y el usuario tiene que poder mirar su tabla de
 * movimientos mientras pregunta por ella. Es justo lo contrario de
 * `MovementDialog`, que sí es modal porque edita algo y no admite distracciones.
 *
 * ALTURAS DE APILADO, que están medidas contra lo que ya existe:
 *
 *     MovementDialog / CategoryCombobox   z-50   ← siguen tapando al chat
 *     panel del chat                      z-40
 *     botón flotante                      z-30
 *     cabecera pegajosa                   z-20
 *
 * Así, editar un movimiento tapa el chat y no al revés, que es el orden correcto:
 * el formulario es la tarea, el chat es la consulta.
 *
 * MINIMIZAR ES ESTE MISMO PANEL con el cuerpo plegado, no otro componente. Un
 * segundo componente para la barra minimizada duplicaría la cabecera y ambas se
 * separarían con el primer retoque.
 */
export type ChatView = "abierto" | "minimizado";

export function ChatPanel({
  view,
  messages,
  pending,
  onSend,
  onMinimize,
  onRestore,
  onClose,
  onClear,
  inputRef,
}: {
  view: ChatView;
  messages: ChatMessageItem[];
  pending: boolean;
  onSend: (question: string) => void;
  onMinimize: () => void;
  onRestore: () => void;
  onClose: () => void;
  onClear: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const minimizado = view === "minimizado";

  return (
    <section
      role="dialog"
      aria-label="Consultar mis datos"
      className={[
        "pointer-events-auto fixed z-40 flex flex-col overflow-hidden",
        "border-zinc-200 bg-zinc-50 shadow-xl dark:border-zinc-800 dark:bg-zinc-950",
        // Móvil: casi toda la pantalla, pegado abajo y dejando ver la cabecera.
        // Minimizado se reduce a la barra de título, que queda flotando abajo.
        minimizado
          ? "inset-x-3 bottom-3 rounded-xl border sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[26rem]"
          : "inset-x-0 top-14 bottom-0 rounded-t-xl border-t sm:inset-x-auto sm:top-auto sm:right-6 sm:bottom-6 sm:h-[min(34rem,calc(100vh-8rem))] sm:w-[26rem] sm:rounded-xl sm:border",
      ].join(" ")}
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <h2 className="flex-1 truncate text-sm font-semibold">Consultar mis datos</h2>

        {!minimizado && messages.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-200/60 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200"
          >
            Limpiar
          </button>
        )}

        <button
          type="button"
          onClick={minimizado ? onRestore : onMinimize}
          aria-label={minimizado ? "Restaurar el chat" : "Minimizar el chat"}
          className="rounded-lg px-2 py-1 text-zinc-500 transition-colors hover:bg-zinc-200/60 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200"
        >
          {/* Dos formas dibujadas con caracteres, como las barras del menú
              móvil: no se carga un paquete de iconos por dos símbolos. */}
          <span aria-hidden="true" className="text-sm leading-none">
            {minimizado ? "▲" : "▁"}
          </span>
        </button>

        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar el chat"
          className="rounded-lg px-2 py-1 text-zinc-500 transition-colors hover:bg-zinc-200/60 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200"
        >
          <span aria-hidden="true" className="text-sm leading-none">
            ✕
          </span>
        </button>
      </header>

      {/* Minimizado se pliega el cuerpo, pero el estado NO se pierde: la
          conversación y la petición en vuelo siguen donde estaban. */}
      {!minimizado && (
        <>
          <ChatMessageList messages={messages} pending={pending} />
          <ChatComposer pending={pending} onSend={onSend} inputRef={inputRef} />
        </>
      )}

      {minimizado && pending && (
        <p className="px-3 pb-2 text-xs text-zinc-500 dark:text-zinc-400">
          Consultando tus datos…
        </p>
      )}
    </section>
  );
}
