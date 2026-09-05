import { EMPTY_RESULT_MESSAGE } from "./limits";
import type { AnswerPayload } from "./present";

/**
 * La red que hay debajo de la redacción.
 *
 * El usuario pidió que el chat NO invente montos. El prompt lo dice, pero un
 * prompt es una petición, no una garantía. Esto lo comprueba: todas las cifras
 * que el modelo tenía derecho a escribir están en el payload que se le mandó, así
 * que basta con mirar si aparece alguna que no estuviera.
 *
 * Si inventa, su texto se tira y se usa una frase construida por el servidor con
 * los mismos datos. Y aquí está lo que hace que esto salga casi gratis: esa
 * frase determinista HACE FALTA IGUAL para el caso de que la segunda llamada
 * falle, se agote el tiempo o no haya clave. Verificar solo añade el `if`.
 *
 * LA TOLERANCIA ES DELIBERADAMENTE AMPLIA. Un falso positivo cuesta una respuesta
 * más sosa; un falso negativo cuesta un importe inventado que el usuario se cree.
 * Aun así se aceptan los enteros pequeños —ordinales, recuentos, «los 5 más
 * altos»— y la parte entera de un importe permitido, porque escribir «1,286
 * soles» cuando el dato es «S/ 1,286.20» es redactar, no inventar.
 */

/** Enteros hasta aquí se consideran del lenguaje, no datos. */
const SMALL_INTEGER_LIMIT = 100;

/**
 * Todas las cifras que el modelo puede escribir legítimamente.
 *
 * Se guardan normalizadas —sin «S/», sin espacios, sin separador de millares—
 * para que «S/ 1,286.20» y «1286.20» sean la misma cifra.
 */
export function collectAllowedNumbers(payload: AnswerPayload): Set<string> {
  const allowed = new Set<string>();

  const add = (text: string) => {
    for (const found of extractNumbers(text)) {
      allowed.add(found);
      // La parte entera también vale: es la misma cifra dicha en corto.
      const [entera] = found.split(".");
      if (entera) allowed.add(entera);
    }
  };

  for (const hecho of payload.hechos) add(hecho.valor);
  for (const fila of payload.filas) {
    add(fila.monto);
    add(fila.detalle);
  }
  // Los dos, porque el modelo puede citar legítimamente una cifra de cualquiera
  // de ellos («solo se muestran 25 de 50»).
  for (const aviso of payload.avisos) add(aviso);
  for (const nota of payload.notasModelo) add(nota);

  add(payload.periodo);
  if (payload.periodoComparado) add(payload.periodoComparado);
  allowed.add(String(payload.totalFilas));
  allowed.add(String(payload.filas.length));

  return allowed;
}

/**
 * Saca las cifras de un texto, ya normalizadas.
 *
 * El separador de millares se quita y la coma decimal se pasa a punto: `es-PE`
 * escribe «1,286.20», pero un modelo puede escribir «1.286,20» y sigue siendo el
 * mismo número.
 */
function extractNumbers(text: string): string[] {
  const matches = text.match(/\d[\d.,]*/g) ?? [];

  return matches.map(normalizeNumber).filter((value) => value !== "");
}

function normalizeNumber(raw: string): string {
  let value = raw.replace(/[.,]$/, "");

  // El último separador con dos dígitos detrás es el decimal; el resto, millares.
  const decimal = value.match(/[.,](\d{2})$/);

  if (decimal) {
    const cuerpo = value.slice(0, -3).replace(/[.,]/g, "");
    value = `${cuerpo}.${decimal[1]}`;
  } else {
    value = value.replace(/[.,]/g, "");
  }

  // Se recortan los ceros de la derecha para que «120.00» y «120» coincidan.
  return value.replace(/\.?0+$/, "").replace(/^$/, "0") || "0";
}

/**
 * ¿Hay en la respuesta alguna cifra que no estuviera en los datos?
 *
 * Los años y los enteros pequeños no cuentan: son parte de cómo se habla, no
 * datos financieros. Lo que se persigue es un importe inventado.
 */
export function inventsNumbers(answer: string, allowed: Set<string>): boolean {
  for (const found of extractNumbers(answer)) {
    if (allowed.has(found)) continue;

    const numero = Number(found);
    if (!Number.isFinite(numero)) continue;

    // Enteros pequeños: ordinales, recuentos, «los 5 más altos».
    if (Number.isInteger(numero) && numero <= SMALL_INTEGER_LIMIT) continue;

    // Un año suelto es una fecha, y las fechas ya vienen en las etiquetas.
    if (Number.isInteger(numero) && numero >= 1900 && numero <= 2100) continue;

    return true;
  }

  return false;
}

/**
 * La respuesta que escribe el SERVIDOR.
 *
 * Correcta y aburrida. Se usa cuando el modelo no está disponible, tarda de más
 * o se inventa una cifra. Nunca falla y nunca imprime `undefined`: es el suelo
 * del chat, y un suelo que se rompe no es un suelo.
 */
export function buildDeterministicAnswer(payload: AnswerPayload): string {
  if (payload.sinDatos) {
    return `${EMPTY_RESULT_MESSAGE} Período consultado: ${payload.periodo}.`;
  }

  const partes: string[] = [];

  const [principal, ...resto] = payload.hechos;

  if (principal) {
    partes.push(`${principal.etiqueta}: ${principal.valor} (${payload.periodo}).`);
  } else {
    partes.push(`Período consultado: ${payload.periodo}.`);
  }

  if (payload.filtros.length > 0) {
    partes.push(`Filtros aplicados: ${payload.filtros.join(", ")}.`);
  }

  const secundarios = resto.slice(0, 3);
  if (secundarios.length > 0) {
    partes.push(
      secundarios.map((hecho) => `${hecho.etiqueta}: ${hecho.valor}`).join(". ") + ".",
    );
  }

  if (payload.filas.length > 0) {
    partes.push(
      payload.filas.length === payload.totalFilas
        ? `Se muestran ${payload.filas.length} filas en la tabla.`
        : `Se muestran ${payload.filas.length} de ${payload.totalFilas} filas en la tabla.`,
    );
  }

  for (const aviso of payload.avisos) partes.push(aviso);

  return partes.join(" ");
}

/**
 * La respuesta final y de dónde salió.
 *
 * `fuente` va al log, no a la interfaz: al usuario le da igual quién redactó, y
 * enseñarlo invitaría a desconfiar de la respuesta del servidor, que es la más
 * fiable de las dos precisamente porque no la escribió un modelo.
 */
export function finalAnswer(
  modelText: string | null,
  payload: AnswerPayload,
): { text: string; fuente: "gemini" | "servidor" } {
  const limpio = modelText?.trim();

  if (!limpio) return { text: buildDeterministicAnswer(payload), fuente: "servidor" };

  if (inventsNumbers(limpio, collectAllowedNumbers(payload))) {
    return { text: buildDeterministicAnswer(payload), fuente: "servidor" };
  }

  return { text: limpio, fuente: "gemini" };
}
