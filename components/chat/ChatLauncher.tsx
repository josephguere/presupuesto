"use client";

import { usePathname } from "next/navigation";
import { useEffect, useReducer, useRef } from "react";
import { ChatPanel } from "./ChatPanel";
import { sendChatQuestion } from "@/lib/chat/client";
import {
  INITIAL_CHAT_STATE,
  chatReducer,
  nextChatId,
  toHistory,
} from "@/lib/chat/state";

/**
 * El botón flotante y el chat que abre.
 *
 * DOS COMPONENTES Y NO UNO CON UN `return null`, y la diferencia importa. El
 * portero (`ChatLauncher`) no tiene estado y decide si el hijo existe; todo el
 * estado vive en `ChatWidget`. Si el `return null` estuviera DENTRO del
 * componente con estado, React mantendría viva la instancia y la conversación
 * sobreviviría a cerrar sesión: el siguiente que entrara con el PIN se
 * encontraría las preguntas del anterior. Así, al llegar a `/login` el hijo se
 * desmonta y el historial se muere de verdad.
 *
 * Es el mismo truco de estado derivado que usa `AppHeader` con `openPath` para
 * cerrar su menú al navegar, y por el mismo motivo: `react-hooks/set-state-in-effect`
 * prohíbe arreglar esto con un efecto que llame a `dispatch`.
 *
 * `enabled` lo calcula el layout EN EL SERVIDOR. Un Client Component no puede
 * leer `GEMINI_API_KEY` —no lleva prefijo `NEXT_PUBLIC_`, y ese es justo el
 * motivo por el que no acaba en el navegador—, así que la decisión tiene que
 * bajar como prop.
 */
export function ChatLauncher({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();

  // Sin clave no hay chat: ver la nota en `lib/ai/config.ts`.
  if (!enabled) return null;

  // En la pantalla de acceso no hay datos que consultar ni sesión con la que
  // hacerlo. Se oculta sola, igual que la cabecera.
  if (pathname === "/login") return null;

  return <ChatWidget />;
}

/** Todo el estado del chat. Privado: solo se llega aquí a través del portero. */
function ChatWidget() {
  const [state, dispatch] = useReducer(chatReducer, INITIAL_CHAT_STATE);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const abierto = state.view !== "cerrado";

  // Escape cierra, como en cualquier panel. Mismo patrón que el menú móvil de
  // `AppHeader`: el efecto solo escucha, no llama a `dispatch` en su cuerpo.
  useEffect(() => {
    if (!abierto) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dispatch({ type: "cerrar" });
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [abierto]);

  // El foco al cuadro de escribir al abrir. Un efecto que solo llama a `.focus()`,
  // sin tocar estado.
  useEffect(() => {
    if (state.view === "abierto") inputRef.current?.focus();
  }, [state.view]);

  /**
   * Al cerrar, el foco vuelve al botón flotante.
   *
   * Tiene que ser AQUÍ y no en `handleClose`: mientras el panel está abierto el
   * botón no está montado —son las dos ramas del mismo ternario—, así que en el
   * manejador la referencia todavía vale `null` y el `focus()` no hace nada. Al
   * llegar a este efecto React ya ha repintado y el botón existe.
   *
   * Se recuerda la vista anterior para no robar el foco en el primer render, que
   * es cuando el chat nunca se ha abierto y el usuario está leyendo su tabla.
   */
  const vistaAnterior = useRef(state.view);

  useEffect(() => {
    const antes = vistaAnterior.current;
    vistaAnterior.current = state.view;

    if (antes !== "cerrado" && state.view === "cerrado") launcherRef.current?.focus();
  }, [state.view]);

  // Al desmontar, se corta lo que quede en vuelo.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function handleSend(question: string) {
    // El reducer ya rechaza el segundo envío si hay uno en curso, y
    // `sendChatQuestion` tiene su propio centinela de módulo. Son dos guardias
    // para dos problemas distintos: el estado repetido y la petición repetida.
    if (state.pending) return;

    const id = nextChatId();
    const history = toHistory(state.messages);

    dispatch({ type: "preguntar", id, question });

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const outcome = await sendChatQuestion({
      question,
      history,
      signal: controller.signal,
    });

    // `null` = ya había una petición viva. No se pinta nada: el turno del usuario
    // ya está en la lista y el guardia de arriba hace que esto sea casi
    // imposible, pero el caso existe y no puede dejar el chat colgado.
    if (!outcome) {
      dispatch({ type: "fallar", id, message: "Espera a que termine la consulta anterior." });
      return;
    }

    if (outcome.ok) dispatch({ type: "responder", id, reply: outcome.reply });
    else dispatch({ type: "fallar", id, message: outcome.message });
  }

  function handleClose() {
    // Cerrar CONSERVA la conversación —reabrir la encuentra donde estaba— pero
    // corta la petición en vuelo: nadie va a leer esa respuesta.
    abortRef.current?.abort();
    dispatch({ type: "cerrar" });
    // El foco lo devuelve el efecto de arriba, cuando el botón vuelva a existir.
  }

  return (
    // Una capa que NO intercepta clics: `pointer-events-none` en el envoltorio y
    // `pointer-events-auto` solo en el botón y en el panel. Sin esto, una capa
    // fija a pantalla completa se tragaría los clics de toda la aplicación, que
    // es exactamente lo contrario de «nunca bloquear el resto de la web».
    <div className="pointer-events-none fixed inset-0 z-30">
      {state.view === "cerrado" ? (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => dispatch({ type: "abrir" })}
          className="pointer-events-auto fixed right-4 bottom-4 flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white shadow-lg transition-colors hover:bg-zinc-700 sm:right-6 sm:bottom-6 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          <span aria-hidden="true">💬</span>
          Consultar mis datos
        </button>
      ) : (
        <ChatPanel
          view={state.view}
          messages={state.messages}
          pending={state.pending}
          onSend={handleSend}
          onMinimize={() => dispatch({ type: "minimizar" })}
          onRestore={() => dispatch({ type: "abrir" })}
          onClose={handleClose}
          onClear={() => dispatch({ type: "limpiar" })}
          inputRef={inputRef}
        />
      )}
    </div>
  );
}
