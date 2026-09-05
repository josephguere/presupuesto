/**
 * El presupuesto de tiempo de una petición del chat.
 *
 * Un mensaje son dos llamadas a Gemini más una consulta a Supabase. Si cada pieza
 * llevara su propio tope independiente, la suma podría superar el `maxDuration`
 * de la función y el usuario vería un corte de la plataforma en lugar de una
 * respuesta. Aquí el tope es UNO para toda la petición y las etapas se reparten
 * lo que queda.
 *
 * El `AbortSignal` se pasa tanto al SDK como a la consulta de Supabase, así que
 * al vencer se cancelan de verdad las peticiones en curso. Es la diferencia con
 * el `Promise.race` de `lib/suggest/gemini.ts`: allí la promesa perdedora sigue
 * viva y la petición sigue facturándose, aunque nadie espere ya su resultado.
 *
 * `release()` existe porque un `setTimeout` pendiente mantiene vivo el bucle de
 * eventos. En una función serverless eso alarga la invocación después de haber
 * respondido, y en las pruebas deja el proceso colgado.
 */

export interface Deadline {
  /** Para el SDK de Gemini y para `getTransactions`. */
  readonly signal: AbortSignal;
  /** Milisegundos que quedan. Nunca negativo. */
  remainingMs(): number;
  expired(): boolean;
  /** Cuánto lleva la petición. Va al log. */
  elapsedMs(): number;
  /** Cancela el temporizador. Va en el `finally` de la ruta. */
  release(): void;
}

/**
 * Arranca el presupuesto.
 *
 * El reloj entra por parámetro para que las pruebas puedan avanzarlo sin esperar
 * de verdad.
 */
export function startDeadline(budgetMs: number, now: () => number = Date.now): Deadline {
  const startedAt = now();
  const controller = new AbortController();

  const timer = setTimeout(() => controller.abort(), budgetMs);

  // Node deja vivo el proceso mientras haya un temporizador pendiente. En el
  // navegador `unref` no existe, de ahí la comprobación.
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    (timer as { unref: () => void }).unref();
  }

  const elapsedMs = () => now() - startedAt;

  return {
    signal: controller.signal,
    elapsedMs,
    remainingMs: () => Math.max(0, budgetMs - elapsedMs()),
    expired: () => elapsedMs() >= budgetMs,
    release: () => clearTimeout(timer),
  };
}

/**
 * Lo que puede durar una etapa: lo que pide, o lo que queda si es menos.
 *
 * Devolver el mínimo evita el caso en que la última llamada arranca con dos
 * segundos de presupuesto y su propio tope de diez la deja esperar ocho segundos
 * a una petición que ya nadie va a leer.
 */
export function stageTimeoutMs(deadline: Deadline, wantedMs: number): number {
  return Math.max(0, Math.min(wantedMs, deadline.remainingMs()));
}
