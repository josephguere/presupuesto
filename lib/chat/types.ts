/**
 * El contrato entre `/api/ai/chat` y la interfaz.
 *
 * Un solo archivo importado por los dos lados: el Route Handler declara su
 * retorno con estos tipos y el cliente los consume, así que el compilador avisa
 * si uno cambia sin el otro.
 *
 * MÓDULO DE TIPOS PURO, sin nada en tiempo de ejecución. Es lo que garantiza que
 * el navegador no arrastre nada de `lib/ai/`, que es exclusivamente de servidor y
 * donde vive el SDK de Gemini.
 *
 * LOS IMPORTES VIAJAN COMO NÚMEROS. Quien los convierte en «S/ 1,286.20» es
 * `formatCurrency` en el cliente, con el mismo formateador que el resto de la
 * aplicación. Si viajaran ya escritos por el modelo, un despiste suyo con las
 * comas produciría una cifra distinta a la de la tabla de Movimientos.
 */

/** Nombres en castellano porque son los que se guardan y se muestran. */
export type ChatRole = "usuario" | "asistente";

/** Un turno tal como viaja en el cuerpo de la petición. */
export interface ChatHistoryTurn {
  role: ChatRole;
  text: string;
}

export interface ChatResultRow {
  /** Categoría, grupo, comercio o fecha, según la intención. */
  label: string;
  /** Segunda columna opcional: la categoría de un movimiento, por ejemplo. */
  detail?: string | null;
  amount?: number | null;
  count?: number | null;
  /**
   * Fila sintética que reúne la cola recortada («y 7 más»).
   *
   * Se pinta distinta para que nadie la confunda con una categoría llamada así.
   */
  rest?: boolean;
}

/** La tabla que acompaña a la respuesta. `null` cuando no hay cifras que enseñar. */
export interface ChatResult {
  intent: string;
  /** Cabeceras en castellano, dos o tres. Las decide el servidor. */
  columns: string[];
  rows: ChatResultRow[];
  total?: number | null;
  periodLabel?: string | null;
  /** Filas que el servidor omitió por el tope. */
  omitted?: number;
}

/** Códigos de error del chat. Cada uno decide qué mensaje ve el usuario. */
export type ChatErrorCode =
  | "pregunta"
  | "sesion"
  | "limite"
  | "limite_diario"
  | "cuota"
  | "generico";

export interface ChatReply {
  ok: true;
  /**
   * La frase redactada, TEXTO PLANO.
   *
   * Se pinta con `{text}` dentro de un `<p>`, nunca con `dangerouslySetInnerHTML`:
   * es texto que ha pasado por un modelo y no hay renderizador de markdown en el
   * proyecto.
   */
  text: string;
  /** `null` fuera de alcance, período futuro o sin cifras que tabular. */
  result: ChatResult | null;
  intent: string;
  /**
   * Lo que el cliente guarda como turno del asistente para la SIGUIENTE petición.
   *
   * No es el texto que se ve. Es una línea corta y escrita por el servidor
   * («total_expenses · agosto de 2026») que basta para que «¿y el mes anterior?»
   * se entienda, sin reenviar al modelo un texto que salió de él y que podría
   * arrastrar el nombre de un comercio con instrucciones dentro.
   */
  historyNote: string | null;
  /** La lectura topó con el máximo de filas: el total podría quedarse corto. */
  truncated: boolean;
}

export interface ChatFailure {
  ok: false;
  code: ChatErrorCode;
  message: string;
  /** Segundos hasta poder reintentar. `0` si no aplica. */
  retryAfterSeconds: number;
}

/** Un mensaje en la conversación del navegador. Nunca sale de la memoria. */
export interface ChatMessageItem {
  id: string;
  role: ChatRole;
  /** Lo que se PINTA. */
  text: string;
  /** Lo que se ENVÍA como historial. `null` en los turnos del usuario. */
  historyNote: string | null;
  result: ChatResult | null;
  /** Fallo de red o del servidor: se pinta como aviso, no como respuesta. */
  failed?: boolean;
}
