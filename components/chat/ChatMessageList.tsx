"use client";

import { useEffect, useRef } from "react";
import { ChatMessage } from "./ChatMessage";
import type { ChatMessageItem } from "@/lib/chat/types";

/**
 * La lista de mensajes: el único contenedor con scroll del chat.
 *
 * AISLA EL EFECTO. `ChatPanel` es marcado puro y por eso se puede renderizar en
 * las pruebas con `renderToStaticMarkup`; el autodesplazamiento, que necesita el
 * DOM, vive aquí y solo aquí.
 *
 * Se asigna `scrollTop` en vez de llamar a `scrollIntoView`: este último desplaza
 * también los contenedores de arriba, así que arrastraría LA PÁGINA de debajo
 * cada vez que llega una respuesta. `overscroll-contain` remata lo mismo por el
 * otro lado: al llegar al final de la lista, la rueda del ratón no continúa
 * desplazando el documento.
 *
 * UNA SOLA REGIÓN VIVA. El indicador «Consultando tus datos…» es el último `<li>`
 * de esta misma lista y no una región aparte: dos `aria-live` anidados hacen que
 * los lectores de pantalla dupliquen o se coman los anuncios.
 */
export function ChatMessageList({
  messages,
  pending,
}: {
  messages: ChatMessageItem[];
  pending: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Al fondo con cada mensaje nuevo y al empezar a consultar. No llama a ningún
  // `setState`, que es lo que prohíbe `react-hooks/set-state-in-effect`.
  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, pending]);

  return (
    <div
      ref={listRef}
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-3"
    >
      {messages.length === 0 && !pending && <EmptyState />}

      <ul aria-live="polite" aria-atomic="false" className="flex flex-col gap-3">
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}

        {pending && (
          <li className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <span
              aria-hidden="true"
              className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-300"
            />
            Consultando tus datos…
          </li>
        )}
      </ul>
    </div>
  );
}

/**
 * Qué se ve al abrir por primera vez.
 *
 * Con ejemplos, no con un «¡Hola!». Un chat en blanco no dice qué sabe responder,
 * y estas cuatro preguntas enseñan el alcance mejor que cualquier explicación.
 */
function EmptyState() {
  return (
    <div className="px-1 py-2 text-sm text-zinc-500 dark:text-zinc-400">
      <p className="mb-2">Pregúntame sobre tus movimientos. Por ejemplo:</p>

      <ul className="flex flex-col gap-1.5">
        {[
          "¿Cuánto gasté este mes?",
          "¿Cuál fue mi categoría con mayor gasto?",
          "Compara mis gastos de agosto y septiembre",
          "Mis cinco movimientos más altos",
        ].map((ejemplo) => (
          <li key={ejemplo} className="text-zinc-600 dark:text-zinc-300">
            · {ejemplo}
          </li>
        ))}
      </ul>
    </div>
  );
}
