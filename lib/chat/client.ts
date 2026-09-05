import {
  CLIENT_TIMEOUT_MS,
  GENERIC_ERROR_MESSAGE,
  SESSION_MESSAGE,
} from "@/lib/ai/limits";
import type { ChatErrorCode, ChatHistoryTurn, ChatReply } from "./types";

/**
 * El transporte a `/api/ai/chat`.
 *
 * UNA PETICIÓN POR MENSAJE ENVIADO, y el centinela está a nivel de MÓDULO, no en
 * un `useRef`: con StrictMode —activo por defecto en el App Router desde Next
 * 13.5.1— un remontaje estrena los refs y el guardia dejaría de guardar.
 *
 * OJO CON LA DIFERENCIA CON `lib/suggest/client.ts`, y no unifiques los dos. Allí
 * los montajes duplicados COMPARTEN la promesa, porque piden lo mismo: la
 * sugerencia del mismo movimiento. Aquí no se puede compartir nada, porque dos
 * preguntas distintas no pueden recibir la misma respuesta. Por eso la segunda
 * llamada devuelve `null` y ni siquiera abre el `fetch`.
 *
 * NUNCA LANZA y nunca reintenta por su cuenta. Un fallo de red se traduce a un
 * mensaje en castellano y el chat sigue vivo; reintentar solo duplicaría el gasto
 * justo cuando algo va mal.
 *
 * Y NUNCA BLOQUEA EL RESTO DE LA WEB: todo es asíncrono, con su propio
 * `AbortController` y su propio tope de espera, así que una respuesta que no
 * llega deja el chat esperando y la aplicación intacta.
 */

export type ChatOutcome =
  | { ok: true; reply: ChatReply }
  | { ok: false; message: string; code: ChatErrorCode };

/** Centinela de módulo: ¿hay una petición viva ahora mismo? */
let inflight = false;

/** Para el componente y para las pruebas. */
export function isAsking(): boolean {
  return inflight;
}

/** Solo para las pruebas: deja el centinela como estaba al empezar. */
export function resetAsking(): void {
  inflight = false;
}

/**
 * Envía la pregunta.
 *
 * @returns `null` si ya había una petición en vuelo. No es un error: es el
 *   segundo Enter que no debe convertirse en una segunda consulta.
 */
export async function sendChatQuestion(input: {
  question: string;
  history: ChatHistoryTurn[];
  signal?: AbortSignal;
}): Promise<ChatOutcome | null> {
  if (inflight) return null;
  inflight = true;

  // Tope propio del navegador, por encima del techo del servidor: si el servidor
  // llega a tiempo, el usuario ve SU mensaje de error, que dice algo útil, y no
  // un fallo de red genérico. Ver la cadena de tiempos en `lib/ai/limits.ts`.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

  // Si quien llama aborta (el panel se cerró), se aborta también aquí.
  const onExternalAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onExternalAbort);

  try {
    const response = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: input.question, history: input.history }),
      signal: controller.signal,
    });

    // SESIÓN CADUCADA. `proxy.ts` no deja pasar una petición sin cookie: responde
    // una redirección 307 al login, y `fetch` la sigue en silencio. Lo que llega
    // entonces es el HTML de la pantalla de acceso con un 200, así que sin esta
    // comprobación el `json()` reventaría con un error de sintaxis incomprensible.
    if (response.redirected || !isJson(response)) {
      return { ok: false, message: SESSION_MESSAGE, code: "sesion" };
    }

    const body = await response.json();

    if (!response.ok || body?.ok !== true) {
      return {
        ok: false,
        // El mensaje lo redacta el servidor, que es quien sabe qué falló.
        message: typeof body?.message === "string" ? body.message : GENERIC_ERROR_MESSAGE,
        code: isErrorCode(body?.code) ? body.code : "generico",
      };
    }

    return { ok: true, reply: body as ChatReply };
  } catch {
    // Red caída, tope de espera vencido o petición abortada: el usuario ve el
    // mismo mensaje. Distinguirlos no le da ninguna acción distinta.
    return { ok: false, message: GENERIC_ERROR_MESSAGE, code: "generico" };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onExternalAbort);
    inflight = false;
  }
}

/** ¿Es de verdad JSON lo que llega? Ver la nota sobre la sesión caducada. */
function isJson(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").includes("application/json");
}

function isErrorCode(value: unknown): value is ChatErrorCode {
  return (
    typeof value === "string" &&
    ["pregunta", "sesion", "limite", "limite_diario", "cuota", "generico"].includes(value)
  );
}
