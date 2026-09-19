import { MAX_HISTORY_CHARS, MAX_HISTORY_MESSAGES, MAX_TURNS } from "@/lib/ai/limits";
import type { ChatHistoryTurn, ChatMessageItem, ChatReply } from "./types";

/**
 * La máquina de estados del chat, como reducer PURO.
 *
 * Vive fuera de todo componente porque el entorno de pruebas del proyecto es
 * `node` y no hay jsdom: sin esto, ni las transiciones ni las reglas del
 * historial se podrían probar. Es el mismo reparto que ya hace el proyecto con
 * `filterCategories` en el combobox — la lógica fuera, el componente solo pinta.
 *
 * UN `view` DE TRES VALORES, no dos booleanos. Con `abierto` y `minimizado` por
 * separado existiría el estado «minimizado pero cerrado», que no significa nada y
 * que alguien acabaría produciendo.
 *
 * LA REGLA DEL HISTORIAL, que el usuario fijó: cerrar CONSERVA la conversación,
 * limpiar la VACÍA. No se guarda en Supabase ni en `localStorage`, así que
 * recargar también la borra, y al cerrar sesión el widget se desmonta entero.
 *
 * EL GUARDIA DEL DOBLE ENVÍO está aquí y no solo en el `disabled` del botón: un
 * atributo deshabilitado es una comodidad visual, y una tecla Enter repetida
 * mientras React repinta puede colarse igual.
 */

export interface ChatState {
  view: "cerrado" | "abierto" | "minimizado";
  messages: ChatMessageItem[];
  pending: boolean;
  /**
   * Identificador del envío vigente.
   *
   * Una respuesta que llega con otro id se descarta: es la que quedó en vuelo
   * cuando el usuario limpió la conversación, y pintarla haría reaparecer un
   * turno que él acaba de borrar.
   */
  requestId: string | null;
}

export type ChatAction =
  | { type: "abrir" }
  | { type: "minimizar" }
  | { type: "cerrar" }
  | { type: "limpiar" }
  | { type: "preguntar"; id: string; question: string }
  | { type: "responder"; id: string; reply: ChatReply }
  | { type: "fallar"; id: string; message: string };

export const INITIAL_CHAT_STATE: ChatState = {
  view: "cerrado",
  messages: [],
  pending: false,
  requestId: null,
};

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "abrir":
      return { ...state, view: "abierto" };

    case "minimizar":
      // Minimizar no cancela nada: la pregunta en vuelo sigue y su respuesta
      // estará esperando al restaurar.
      return { ...state, view: "minimizado" };

    case "cerrar":
      return { ...state, view: "cerrado" };

    case "limpiar":
      // Se suelta también el envío en curso: su respuesta ya no tiene dónde ir.
      return { ...state, messages: [], pending: false, requestId: null };

    case "preguntar": {
      // El guardia: con una petición en vuelo, la segunda no entra.
      if (state.pending) return state;

      return {
        ...state,
        pending: true,
        requestId: action.id,
        messages: trim([
          ...state.messages,
          {
            id: action.id,
            role: "usuario",
            text: action.question,
            historyNote: null,
            result: null,
          },
        ]),
      };
    }

    case "responder": {
      // Respuesta de un envío que ya no es el vigente: se tira.
      if (state.requestId !== action.id) return state;

      return {
        ...state,
        pending: false,
        requestId: null,
        messages: trim([
          ...state.messages,
          {
            id: `${action.id}-r`,
            role: "asistente",
            text: action.reply.text,
            historyNote: action.reply.historyNote,
            result: action.reply.result,
          },
        ]),
      };
    }

    case "fallar": {
      if (state.requestId !== action.id) return state;

      return {
        ...state,
        pending: false,
        requestId: null,
        messages: trim([
          ...state.messages,
          {
            id: `${action.id}-e`,
            role: "asistente",
            text: action.message,
            // Un fallo NO entra en el historial que se envía: no es un turno de
            // conversación, y reenviarlo solo confundiría a la siguiente
            // extracción de intención.
            historyNote: null,
            result: null,
            failed: true,
          },
        ]),
      };
    }
  }
}

/** Se conservan los últimos turnos; los viejos salen por delante. */
function trim(messages: ChatMessageItem[]): ChatMessageItem[] {
  const tope = MAX_TURNS * 2;
  return messages.length <= tope ? messages : messages.slice(messages.length - tope);
}

/**
 * El historial tal como viaja al servidor.
 *
 * Se envía MENOS de lo que se ve, y es deliberado: el usuario puede releer doce
 * turnos y el modelo solo ve los seis últimos. Leer es gratis; enviar cuesta
 * tokens en cada mensaje.
 *
 * De los turnos del asistente va `historyNote` —la línea corta que escribió el
 * SERVIDOR—, no el texto redactado. Así el texto que salió de un modelo, y que
 * puede arrastrar el nombre de un comercio con instrucciones dentro, no vuelve a
 * entrar en el prompt siguiente. Ver `lib/chat/types.ts`.
 *
 * Los mensajes fallidos se saltan: no son conversación.
 */
export function toHistory(messages: ChatMessageItem[]): ChatHistoryTurn[] {
  const utiles = messages.filter((message) => !message.failed);

  return utiles.slice(-MAX_HISTORY_MESSAGES).map((message) => ({
    role: message.role,
    text: (message.historyNote ?? message.text).slice(0, MAX_HISTORY_CHARS),
  }));
}

/**
 * Identificadores de mensaje.
 *
 * Un contador de módulo y no `crypto.randomUUID()`: no hace falta que sean
 * únicos en el mundo, solo dentro de esta lista, y así las pruebas son
 * deterministas. `resetChatIds` existe para ellas.
 */
let counter = 0;

export function nextChatId(): string {
  counter += 1;
  return `m${counter}`;
}

export function resetChatIds(): void {
  counter = 0;
}
