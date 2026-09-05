/**
 * Cliente de la sugerencia de categoría.
 *
 * UNA PETICIÓN POR APERTURA DEL MODAL, y el problema real es React en
 * desarrollo: con StrictMode —activo por defecto en el App Router desde Next
 * 13.5.1— cada efecto se monta, se limpia y se vuelve a montar, así que un
 * `useEffect` ingenuo dispara dos veces.
 *
 * Un `useRef` centinela dentro del componente no basta: el segundo montaje
 * estrena refs. La solución es un mapa de peticiones EN VUELO a nivel de módulo:
 * el segundo montaje encuentra la promesa del primero y se cuelga de ella en vez
 * de abrir otra.
 *
 * Y por eso el `abort` se aplaza un turno del bucle de eventos. StrictMode
 * limpia y remonta en el mismo turno; si se abortara de inmediato, el primer
 * montaje cancelaría la petición que el segundo acaba de heredar.
 */

export interface CategorySuggestion {
  categoryId: string | null;
  category: string | null;
  summary: string | null;
  group: string | null;
  reason: string | null;
  source: "history" | "gemini" | "none";
  matches: number;
}

interface Inflight {
  promise: Promise<CategorySuggestion | null>;
  controller: AbortController;
  /** Cuántos montajes siguen esperando esta respuesta. */
  consumers: number;
}

const inflight = new Map<string, Inflight>();

/**
 * Pide la sugerencia de un movimiento.
 *
 * Devuelve una función de cancelación. Al llamarla, este consumidor deja de
 * estar interesado; la petición solo se aborta de verdad cuando no queda
 * ninguno.
 */
export function requestSuggestion(
  transactionId: string,
  onDone: (suggestion: CategorySuggestion | null) => void,
): () => void {
  let active = true;

  const entry = inflight.get(transactionId) ?? start(transactionId);
  entry.consumers += 1;

  entry.promise
    .then((suggestion) => {
      // Si el modal se cerró, la respuesta se descarta sin tocar nada.
      if (active) onDone(suggestion);
    })
    .catch(() => {
      if (active) onDone(null);
    });

  return () => {
    active = false;
    entry.consumers -= 1;

    // Aplazado un macrotask: en el remontaje de StrictMode, el consumidor nuevo
    // se apunta justo después de que el viejo se dé de baja.
    setTimeout(() => {
      if (entry.consumers <= 0) {
        entry.controller.abort();
        inflight.delete(transactionId);
      }
    }, 0);
  };
}

function start(transactionId: string): Inflight {
  const controller = new AbortController();

  const promise = fetch("/api/transactions/suggest-category", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactionId }),
    signal: controller.signal,
  })
    .then((response) => (response.ok ? (response.json() as Promise<CategorySuggestion>) : null))
    .catch(() => null)
    .finally(() => {
      // Se libera al terminar: reabrir el modal vuelve a preguntar, que es lo
      // correcto si entretanto se categorizaron otros movimientos.
      inflight.delete(transactionId);
    });

  const entry: Inflight = { promise, controller, consumers: 0 };
  inflight.set(transactionId, entry);

  return entry;
}
