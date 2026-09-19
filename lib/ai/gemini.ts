import { chatModel } from "./config";
import { fromGemini } from "./errors";
import { stageTimeoutMs, type Deadline } from "./deadline";
import { GEMINI_TIMEOUT_MS, MAX_OUTPUT_TOKENS } from "./limits";
import { buildIntentResponseSchema } from "./intent";
import {
  ANSWER_SYSTEM_INSTRUCTION,
  buildAnswerPrompt,
  buildIntentContents,
  buildIntentSystemInstruction,
} from "./prompts";
import type { Catalog } from "./catalog";
import type { AnswerPayload } from "./present";
import type { ChatHistoryTurn } from "@/lib/chat/types";

/**
 * Las dos llamadas al modelo.
 *
 * Mismo patrón que `lib/suggest/gemini.ts` —import dinámico del SDK,
 * `temperature: 0`, el `responseSchema` como jaula— con una diferencia que sí
 * importa: aquí la cancelación es REAL.
 *
 * `lib/suggest/gemini.ts` corta con `Promise.race`, y eso solo abandona la espera:
 * la petición HTTP sigue viva y sigue facturándose. Aquí se pasan
 * `httpOptions.timeout` y `config.abortSignal`, así que al vencer el presupuesto
 * el `fetch` se aborta de verdad.
 *
 * `retryOptions.attempts: 1` es explícito y no es una precaución teórica: el SDK
 * reintenta por defecto ante un 429, que es justo el código de «cuota agotada».
 * Sin esto, un mensaje se convertiría en cinco peticiones contra una cuota que ya
 * no existe, y cada una esperando su retardo exponencial dentro de nuestro
 * presupuesto de tiempo.
 *
 * NADA DE HERRAMIENTAS NI DE GROUNDING: `tools: []` y la llamada automática a
 * funciones desactivada. El modelo no puede buscar en internet ni invocar nada;
 * su único contacto con los datos del usuario son los hechos que ya le damos.
 */

export interface GeminiCallResult<T> {
  value: T;
  usage: { prompt: number; output: number };
  elapsedMs: number;
}

/**
 * Configuración compartida por las dos llamadas.
 *
 * Ninguna herramienta, ninguna búsqueda, temperatura cero. `thinkingConfig` NO se
 * toca: `gemini-3.5-flash-lite` rechaza con 400 un presupuesto de razonamiento
 * de cero, así que fijarlo rompería el chat entero por ahorrar unos tokens.
 */
function baseConfig(signal: AbortSignal, timeoutMs: number) {
  return {
    temperature: 0,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    tools: [],
    automaticFunctionCalling: { disable: true },
    abortSignal: signal,
    httpOptions: {
      timeout: timeoutMs,
      // Sin reintentos: ver la cabecera.
      retryOptions: { attempts: 1 },
    },
  };
}

/** El cliente, creado en cada llamada. Es barato y evita estado entre peticiones. */
async function createClient() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  // La ruta ya comprobó `isChatConfigured`, pero esto no puede depender de que
  // el llamador se acuerde: sin clave se lanza en vez de mandar una vacía.
  if (!apiKey) throw new Error("GEMINI_API_KEY no configurada");

  // Import dinámico: si nadie usa el chat, el SDK no se carga.
  const { GoogleGenAI } = await import("@google/genai");
  return new GoogleGenAI({ apiKey });
}

/** Lo que el SDK reporta de consumo. Va al log, nunca a la respuesta. */
function readUsage(response: unknown): { prompt: number; output: number } {
  const meta = (response as { usageMetadata?: Record<string, unknown> })?.usageMetadata;

  return {
    prompt: Number(meta?.promptTokenCount ?? 0),
    output: Number(meta?.candidatesTokenCount ?? 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Llamada 1: pregunta → intención                                             */
/* -------------------------------------------------------------------------- */

/**
 * Traduce la pregunta a una intención estructurada.
 *
 * Devuelve el objeto CRUDO. Quien lo valida es `parseIntent`, y esa separación es
 * deliberada: el módulo que habla con la red no debería ser también el que decide
 * si lo que llegó es de fiar.
 */
export async function callIntent(input: {
  question: string;
  history: ChatHistoryTurn[];
  catalog: Catalog;
  now: Date;
  deadline: Deadline;
}): Promise<GeminiCallResult<unknown>> {
  const startedAt = input.deadline.elapsedMs();

  try {
    const ai = await createClient();

    const response = await ai.models.generateContent({
      model: chatModel(),
      contents: buildIntentContents(input.question, input.history),
      config: {
        ...baseConfig(input.deadline.signal, stageTimeoutMs(input.deadline, GEMINI_TIMEOUT_MS)),
        systemInstruction: buildIntentSystemInstruction(input.catalog, input.now),
        responseMimeType: "application/json",
        // La jaula: fuera de este esquema el modelo no puede responder nada.
        responseSchema: buildIntentResponseSchema(input.catalog),
      },
    });

    const raw = response.text;

    return {
      // Un JSON ilegible se devuelve como `null`; `parseIntent` lo rechaza con
      // el motivo «respuesta_ilegible» en lugar de reventar aquí.
      value: raw ? safeParse(raw) : null,
      usage: readUsage(response),
      elapsedMs: input.deadline.elapsedMs() - startedAt,
    };
  } catch (error) {
    throw fromGemini(error, "intencion");
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Llamada 2: hechos → respuesta                                               */
/* -------------------------------------------------------------------------- */

/**
 * Redacta la respuesta a partir de los hechos ya consultados.
 *
 * Sin `responseSchema`: aquí la salida es prosa. La jaula de esta llamada es otra
 * y está en la entrada —solo ve cadenas ya formateadas, nunca números sueltos— y
 * en la salida, donde `lib/ai/answer.ts` comprueba que no se haya inventado
 * ninguna cifra.
 */
export async function callAnswer(input: {
  question: string;
  payload: AnswerPayload;
  deadline: Deadline;
}): Promise<GeminiCallResult<string>> {
  const startedAt = input.deadline.elapsedMs();

  try {
    const ai = await createClient();

    const response = await ai.models.generateContent({
      model: chatModel(),
      contents: buildAnswerPrompt(input.question, input.payload),
      config: {
        ...baseConfig(input.deadline.signal, stageTimeoutMs(input.deadline, GEMINI_TIMEOUT_MS)),
        systemInstruction: ANSWER_SYSTEM_INSTRUCTION,
      },
    });

    return {
      value: (response.text ?? "").trim(),
      usage: readUsage(response),
      elapsedMs: input.deadline.elapsedMs() - startedAt,
    };
  } catch (error) {
    throw fromGemini(error, "redaccion");
  }
}
