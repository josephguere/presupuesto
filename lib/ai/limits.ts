/**
 * Los números y los textos del chat, en un solo sitio.
 *
 * SIN DEPENDENCIAS, a propósito. Lo importan el Route Handler, los componentes
 * del navegador y las pruebas, así que no puede arrastrar ni Supabase ni el SDK
 * de Gemini. Es lo que permite que el `maxLength` del cuadro de texto y el
 * `.max()` de zod sean literalmente el mismo número en vez de dos que hay que
 * acordarse de mover a la vez.
 *
 * Los textos visibles viven aquí y no repartidos por los módulos por la misma
 * razón: el mensaje de «fuera de alcance» está fijado letra por letra y tiene que
 * existir UNA sola vez en el repositorio para que no haya dos versiones.
 */

/* -------------------------------------------------------------------------- */
/* Tamaños                                                                     */
/* -------------------------------------------------------------------------- */

/** Menos de esto no es una pregunta. */
export const MIN_QUESTION_LENGTH = 2;

/**
 * Tope de la pregunta.
 *
 * Quinientos caracteres son de sobra para cualquier pregunta sobre gastos y a la
 * vez impiden pegar un texto largo con instrucciones dentro. El cuadro de texto
 * usa este mismo número como `maxLength`, así que el corte se ve al escribir en
 * vez de aparecer como un error después de enviar.
 */
export const MAX_QUESTION_LENGTH = 500;

/**
 * Turnos que se conservan EN PANTALLA.
 *
 * Es distinto de lo que se envía —ver `MAX_HISTORY_MESSAGES`—: el usuario puede
 * releer doce turnos, y el modelo solo ve los seis últimos. La diferencia es
 * deliberada: leer es gratis, enviar cuesta tokens en cada mensaje.
 */
export const MAX_TURNS = 12;

/** Mensajes de historial que viajan al modelo. Bastan para «¿y el mes anterior?». */
export const MAX_HISTORY_MESSAGES = 6;

/** Cada mensaje del historial se recorta a esto antes de enviarlo. */
export const MAX_HISTORY_CHARS = 400;

/**
 * Filas que ve el modelo al redactar.
 *
 * Veinticinco bastan para describir un desglose o una lista, y ponen un techo al
 * tamaño del prompt que no depende de cuántos movimientos tenga el usuario.
 */
export const MAX_ROWS_TO_MODEL = 25;

/** Filas que se pintan en la tabla de una respuesta. El resto se resume. */
export const MAX_VISIBLE_ROWS = 20;

/* -------------------------------------------------------------------------- */
/* Consumo                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Mensajes por minuto.
 *
 * Cada mensaje son DOS llamadas a Gemini, así que ocho mensajes son dieciséis
 * peticiones. Es holgado para una persona escribiendo y corta en seco un bucle
 * accidental.
 */
export const MESSAGES_PER_MINUTE = 8;

/** Tope diario, que es el que protege la cuota de verdad. */
export const MESSAGES_PER_DAY = 150;

export const MINUTE_WINDOW_SECONDS = 60;
export const DAY_WINDOW_SECONDS = 86_400;

/* -------------------------------------------------------------------------- */
/* Tiempos                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Tope de cada llamada a Gemini.
 *
 * Diez segundos y no seis por lo que ya documenta `lib/suggest/gemini.ts`: la
 * primera llamada del proceso paga el arranque del SDK y el saludo TLS.
 */
export const GEMINI_TIMEOUT_MS = 10_000;

/**
 * Presupuesto de la petición entera: las dos llamadas más la consulta.
 *
 * LOS TRES TIEMPOS ESTÁN ENCADENADOS y el orden importa:
 *
 *     CLIENT_TIMEOUT_MS  >  maxDuration (30 s)  >  REQUEST_BUDGET_MS
 *
 * Si el cliente se rindiera antes que el servidor, el usuario vería su propio
 * error de red en lugar del mensaje que el servidor sabe redactar. Hay una
 * prueba que afirma esta desigualdad para que nadie mueva uno solo de los tres.
 */
export const REQUEST_BUDGET_MS = 24_000;

/** Lo que espera el navegador antes de rendirse. Mayor que el techo del servidor. */
export const CLIENT_TIMEOUT_MS = 32_000;

/** Tope de la redacción. Una respuesta sobre gastos no necesita más. */
export const MAX_OUTPUT_TOKENS = 1_024;

/* -------------------------------------------------------------------------- */
/* Textos                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Fuera de alcance. EXACTO, letra por letra.
 *
 * Lo fijó el usuario y hay una prueba de igualdad estricta: si alguien lo
 * reescribe «mejor», la suite lo detiene.
 */
export const OUT_OF_SCOPE_MESSAGE =
  "Solo puedo responder preguntas relacionadas con tus movimientos y datos de presupuesto.";

/** El error genérico. Tampoco cambia: lo fijó el usuario. */
export const GENERIC_ERROR_MESSAGE =
  "No pude consultar tus datos en este momento. Inténtalo nuevamente.";

export const TOO_FAST_MESSAGE =
  "Estás enviando preguntas muy rápido. Espera unos segundos y vuelve a intentarlo.";

export const DAILY_LIMIT_MESSAGE =
  "Alcanzaste el límite de consultas de hoy. Vuelve a intentarlo mañana.";

export const QUOTA_MESSAGE =
  "El servicio de IA agotó su cuota por ahora. Inténtalo más tarde.";

/** El mismo texto que `lib/auth/guard.ts`, para no tener dos formas de decirlo. */
export const SESSION_MESSAGE = "Tu sesión expiró. Vuelve a ingresar tu código.";

export const QUESTION_TOO_LONG_MESSAGE = `La pregunta debe tener entre ${MIN_QUESTION_LENGTH} y ${MAX_QUESTION_LENGTH} caracteres.`;

/** Cero filas NO es un error: es una respuesta legítima. */
export const EMPTY_RESULT_MESSAGE =
  "No encontré movimientos que cumplan esos filtros.";

export const FUTURE_PERIOD_MESSAGE =
  "Ese período aún no ha ocurrido, así que no hay movimientos que consultar.";

/** Lectura truncada: la respuesta lo dice en vez de aparentar exhaustividad. */
export const TRUNCATED_WARNING =
  "La consulta alcanzó el tope de movimientos que se leen de una vez, así que el total podría quedarse corto.";
