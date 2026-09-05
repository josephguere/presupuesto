import {
  DEFAULT_PERIOD,
  isRealDate,
  previousPeriod,
  resolvePeriod,
  type PeriodSpec,
  type ResolvedPeriod,
} from "@/lib/period";
import { GENERIC_ERROR_MESSAGE, OUT_OF_SCOPE_MESSAGE } from "./limits";
import {
  CATALOG_NONE,
  catalogEnums,
  describeUnknownTerm,
  resolveCategoryMatch,
  resolveGroupMatch,
  resolveSummaryMatch,
  type Catalog,
} from "./catalog";
import type { Group, SummaryCategory } from "@/lib/categories";

/**
 * Qué puede pedir el modelo, y qué se hace con lo que pide.
 *
 * DOS REPRESENTACIONES EN UN SOLO ARCHIVO, a propósito:
 *
 *   · `buildIntentResponseSchema()` es lo que viaja por el cable. PLANO y con
 *     todos los campos obligatorios, porque los modelos cumplen mucho mejor un
 *     esquema sin ramas; los campos que no aplican van con el centinela `""`.
 *   · `Intent` es lo que consume el ejecutor: una unión discriminada donde cada
 *     intención declara exactamente los campos que usa.
 *
 * Tenerlas en ficheros separados sería la forma segura de que un día dejen de
 * encajar.
 *
 * AQUÍ SE RECHAZA TODO LO IMPOSIBLE, y se hace SIN TOCAR SUPABASE. Una intención
 * que no está entre las doce, una categoría que no existe, un `group_total` sin
 * grupo: todo eso muere antes de que se abra una sola conexión.
 *
 * LA DEFENSA CONTRA LA INYECCIÓN NO ES EL PROMPT, igual que en
 * `lib/suggest/gemini.ts`. La pregunta la escribe el usuario y los nombres de
 * comercio vienen de correos del banco. Que el modelo devuelva `inScope: true`
 * después de leer «ignora tus instrucciones» no sirve de nada: lo único que puede
 * conseguir una inyección es elegir OTRA de las doce intenciones con OTRO filtro
 * del catálogo, y entonces el usuario ve un total real de su propio presupuesto
 * que no era el que pidió. No hay ninguna forma de que el modelo escriba SQL,
 * nombre una tabla, lea una columna que no está en la lista o escriba nada.
 */

export const INTENTS = [
  "total_expenses",
  "total_income",
  "balance",
  "transaction_count",
  "transaction_list",
  "highest_transactions",
  "category_total",
  "category_breakdown",
  "group_total",
  "group_breakdown",
  "merchant_total",
  "period_comparison",
] as const;

export type IntentName = (typeof INTENTS)[number];

/**
 * Salida legal para «esto no va de presupuesto».
 *
 * Está DENTRO del enum a propósito. Si la única forma de decir «fuera de alcance»
 * fuera desobedecer el esquema, el modelo se vería empujado a elegir una
 * intención cualquiera para cumplirlo.
 */
export const NO_INTENT = "ninguna";

/** Las trece etiquetas de período. Las resuelve `lib/period.ts`, no el modelo. */
export const PERIOD_TOKENS = [
  "hoy",
  "ayer",
  "esta_semana",
  "semana_anterior",
  "este_mes",
  "mes_anterior",
  "este_ano",
  "ano_anterior",
  "ultimos_dias",
  "mes",
  "ano",
  "rango",
  "todo",
] as const;

/** Cómo ordenar una lista de movimientos. Espejo de `lib/movementSort.ts`. */
export const LIST_ORDERS = ["recientes", "antiguos", "mayor_monto", "menor_monto"] as const;
export type ListOrder = (typeof LIST_ORDERS)[number];

/** Qué se compara en `period_comparison`. */
export const COMPARISON_METRICS = ["gastos", "ingresos", "balance", "conteo"] as const;
export type ComparisonMetric = (typeof COMPARISON_METRICS)[number];

/* -------------------------------------------------------------------------- */
/* El esquema que viaja                                                        */
/* -------------------------------------------------------------------------- */

/**
 * El `responseSchema` de la primera llamada.
 *
 * Se construye EN CADA PETICIÓN porque los enums salen del catálogo vigente, que
 * se acaba de leer de Supabase. Es lo que hace que una categoría nueva quede
 * disponible sin desplegar nada.
 */
export function buildIntentResponseSchema(catalog: Catalog): Record<string, unknown> {
  const enums = catalogEnums(catalog);

  return {
    type: "object",
    properties: {
      enAlcance: {
        type: "boolean",
        description: "false si la pregunta no trata sobre los movimientos del usuario",
      },
      intencion: { type: "string", enum: [...INTENTS, NO_INTENT] },
      periodo: { type: "string", enum: [...PERIOD_TOKENS] },
      periodoDias: {
        type: "integer",
        description: "Solo con periodo=ultimos_dias. 0 en cualquier otro caso.",
      },
      periodoMes: { type: "integer", description: "1-12 con periodo=mes. 0 si no aplica." },
      periodoAno: {
        type: "integer",
        description: "Año con periodo=mes o ano. 0 si no se dijo.",
      },
      periodoDesde: {
        type: "string",
        description: "YYYY-MM-DD con periodo=rango. Cadena vacía si no aplica.",
      },
      periodoHasta: {
        type: "string",
        description: "YYYY-MM-DD con periodo=rango. Cadena vacía si no aplica.",
      },
      periodoComparado: {
        type: "string",
        enum: [...PERIOD_TOKENS, CATALOG_NONE],
        description: "Segundo período de period_comparison. NINGUNA para el anterior natural.",
      },
      metrica: { type: "string", enum: [...COMPARISON_METRICS] },
      categoria: { type: "string", enum: enums.categorias },
      categoriaResumen: { type: "string", enum: enums.resumenes },
      grupo: { type: "string", enum: enums.grupos },
      sinCategoria: {
        type: "boolean",
        description: "true solo si pregunta por lo que NO tiene categoría",
      },
      comercio: {
        type: "string",
        description: "Nombre del comercio tal como lo dijo. Cadena vacía si no lo dijo.",
      },
      orden: { type: "string", enum: [...LIST_ORDERS] },
      limite: { type: "integer", description: "Cuántos movimientos pidió. 0 si no lo dijo." },
    },
    // Todos obligatorios: un esquema plano y sin opcionales es el que mejor
    // cumplen los modelos. Los campos que no aplican llevan el centinela.
    required: [
      "enAlcance",
      "intencion",
      "periodo",
      "periodoDias",
      "periodoMes",
      "periodoAno",
      "periodoDesde",
      "periodoHasta",
      "periodoComparado",
      "metrica",
      "categoria",
      "categoriaResumen",
      "grupo",
      "sinCategoria",
      "comercio",
      "orden",
      "limite",
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* La intención ya validada                                                    */
/* -------------------------------------------------------------------------- */

/** Filtros de clasificación. Los comparten varias intenciones. */
export interface IntentFilters {
  categoria?: string;
  categoriaResumen?: SummaryCategory;
  grupo?: Group;
  sinCategoria?: boolean;
  comercio?: string;
}

export type Intent =
  | {
      intencion: "total_expenses" | "total_income" | "balance" | "transaction_count";
      periodo: PeriodSpec;
      filtros: IntentFilters;
    }
  | {
      intencion: "transaction_list";
      periodo: PeriodSpec;
      filtros: IntentFilters;
      orden: ListOrder;
      limite: number;
    }
  | {
      intencion: "highest_transactions";
      periodo: PeriodSpec;
      filtros: IntentFilters;
      limite: number;
    }
  | { intencion: "category_total"; periodo: PeriodSpec; filtros: IntentFilters }
  | {
      intencion: "category_breakdown";
      periodo: PeriodSpec;
      filtros: IntentFilters;
      nivel: "categoria" | "resumen";
      limite: number;
    }
  | { intencion: "group_total"; periodo: PeriodSpec; filtros: IntentFilters }
  | { intencion: "group_breakdown"; periodo: PeriodSpec; filtros: IntentFilters }
  | { intencion: "merchant_total"; periodo: PeriodSpec; filtros: IntentFilters }
  | {
      intencion: "period_comparison";
      periodo: PeriodSpec;
      periodoComparado: PeriodSpec;
      filtros: IntentFilters;
      metrica: ComparisonMetric;
    };

export interface IntentRejection {
  motivo: "fuera_de_alcance" | "intencion_incoherente" | "respuesta_ilegible";
  /** Ya redactado POR EL SERVIDOR. Nunca texto del modelo. */
  mensaje: string;
  /** Solo para el log. */
  detalle: string;
}

export type IntentParse =
  | { ok: true; intent: Intent }
  | { ok: false; rechazo: IntentRejection };

/* -------------------------------------------------------------------------- */
/* Validación                                                                  */
/* -------------------------------------------------------------------------- */

/** Topes por intención. El modelo puede pedir menos, nunca más. */
export const LIMITES = {
  transaction_list: { defecto: 20, maximo: 50 },
  highest_transactions: { defecto: 5, maximo: 20 },
  breakdown: { defecto: 15, maximo: 15 },
} as const;

/**
 * La única puerta de entrada.
 *
 * No hace entrada/salida: valida, normaliza y recorta. Si alguna prueba de este
 * módulo necesitara un doble de Supabase, sería la señal de que se está
 * consultando antes de validar.
 */
export function parseIntent(raw: unknown, catalog: Catalog, now: Date = new Date()): IntentParse {
  if (typeof raw !== "object" || raw === null) {
    return rechazo("respuesta_ilegible", "el modelo no devolvió un objeto");
  }

  const campos = raw as Record<string, unknown>;

  // Fuera de alcance: lo dice el modelo, y el servidor lo respeta sin más
  // preguntas. La comprobación que de verdad contiene es la del enum de
  // `intencion`: sin una de las doce no hay nada que ejecutar.
  if (campos.enAlcance === false) {
    return rechazo("fuera_de_alcance", "el modelo marcó la pregunta fuera de alcance");
  }

  const nombre = campos.intencion;
  if (typeof nombre !== "string" || !(INTENTS as readonly string[]).includes(nombre)) {
    return rechazo(
      "fuera_de_alcance",
      `intención no reconocida: ${typeof nombre === "string" ? nombre.slice(0, 40) : typeof nombre}`,
    );
  }

  const intencion = nombre as IntentName;
  const periodo = readPeriod(campos);
  const filtros = readFilters(campos, catalog);

  // Un término que el modelo puso pero el catálogo no reconoce: se avisa en
  // lugar de responder por otra categoría o de ignorarlo en silencio.
  if (filtros.error) {
    return { ok: false, rechazo: { motivo: "intencion_incoherente", mensaje: filtros.error, detalle: "término fuera del catálogo" } };
  }

  switch (intencion) {
    case "total_expenses":
    case "total_income":
    case "balance":
    case "transaction_count":
      return { ok: true, intent: { intencion, periodo, filtros: filtros.value } };

    case "transaction_list":
      return {
        ok: true,
        intent: {
          intencion,
          periodo,
          filtros: filtros.value,
          orden: readOrder(campos.orden),
          limite: readLimit(campos.limite, LIMITES.transaction_list),
        },
      };

    case "highest_transactions":
      return {
        ok: true,
        intent: {
          intencion,
          periodo,
          filtros: filtros.value,
          limite: readLimit(campos.limite, LIMITES.highest_transactions),
        },
      };

    case "category_total": {
      // Sin categoría no hay nada que totalizar. Se degrada al desglose en vez
      // de fallar: «¿cuánto gasté por categoría?» acaba aquí a menudo, y el
      // desglose es exactamente lo que esa pregunta quería.
      const { categoria, categoriaResumen, sinCategoria } = filtros.value;
      if (!categoria && !categoriaResumen && !sinCategoria) {
        return {
          ok: true,
          intent: {
            intencion: "category_breakdown",
            periodo,
            filtros: filtros.value,
            nivel: "categoria",
            limite: LIMITES.breakdown.defecto,
          },
        };
      }
      return { ok: true, intent: { intencion, periodo, filtros: filtros.value } };
    }

    case "category_breakdown":
      return {
        ok: true,
        intent: {
          intencion,
          periodo,
          filtros: filtros.value,
          // Con un grupo o un resumen pedido, el detalle útil es la categoría;
          // sin nada, el resumen, que son dieciséis filas y no veintinueve.
          nivel:
            filtros.value.grupo || filtros.value.categoriaResumen ? "categoria" : "resumen",
          limite: LIMITES.breakdown.defecto,
        },
      };

    case "group_total": {
      // Un total de grupo sin grupo es el desglose por grupos, que es lo que
      // significa «¿en qué grupo estoy gastando más?».
      if (!filtros.value.grupo) {
        return { ok: true, intent: { intencion: "group_breakdown", periodo, filtros: filtros.value } };
      }
      return { ok: true, intent: { intencion, periodo, filtros: filtros.value } };
    }

    case "group_breakdown":
      return { ok: true, intent: { intencion, periodo, filtros: filtros.value } };

    case "merchant_total": {
      if (!filtros.value.comercio) {
        return rechazo(
          "intencion_incoherente",
          "merchant_total sin comercio",
          "Necesito que me digas de qué comercio quieres el dato.",
        );
      }
      return { ok: true, intent: { intencion, periodo, filtros: filtros.value } };
    }

    case "period_comparison": {
      const comparado = readComparedPeriod(campos, periodo, now);

      // `todo` no tiene período anterior: no hay nada con lo que comparar.
      if (!comparado) {
        return rechazo(
          "intencion_incoherente",
          "period_comparison sin segundo período posible",
          "Necesito dos períodos concretos para comparar. Dime cuáles, por ejemplo «agosto y septiembre».",
        );
      }

      return {
        ok: true,
        intent: {
          intencion,
          periodo,
          periodoComparado: comparado,
          filtros: filtros.value,
          metrica: readMetric(campos.metrica),
        },
      };
    }
  }
}

/**
 * El rechazo, con el mensaje que le corresponde a cada motivo.
 *
 * `respuesta_ilegible` NO es fuera de alcance, y confundirlos era mentirle al
 * usuario: cuando Gemini devuelve un JSON truncado, su pregunta sobre gastos
 * estaba perfectamente dentro del alcance y lo que falló fue el modelo. Decirle
 * «solo respondo sobre tus movimientos» le hace pensar que preguntó mal y no
 * volver a intentarlo, cuando reintentar es justo lo que arregla el caso.
 */
function rechazo(
  motivo: IntentRejection["motivo"],
  detalle: string,
  mensaje?: string,
): { ok: false; rechazo: IntentRejection } {
  const porDefecto =
    motivo === "respuesta_ilegible" ? GENERIC_ERROR_MESSAGE : OUT_OF_SCOPE_MESSAGE;

  return {
    ok: false,
    rechazo: {
      motivo,
      mensaje: mensaje ?? porDefecto,
      detalle,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Lectura de cada campo                                                       */
/* -------------------------------------------------------------------------- */

/** El período pedido. Lo que no se entiende cae al mes en curso. */
function readPeriod(campos: Record<string, unknown>): PeriodSpec {
  const token = campos.periodo;
  if (typeof token !== "string" || !(PERIOD_TOKENS as readonly string[]).includes(token)) {
    return DEFAULT_PERIOD;
  }

  switch (token) {
    case "ultimos_dias": {
      const days = readInteger(campos.periodoDias);
      return days > 0 ? { kind: "ultimos_dias", days } : DEFAULT_PERIOD;
    }

    case "mes": {
      const month = readInteger(campos.periodoMes);
      if (month < 1 || month > 12) return DEFAULT_PERIOD;

      const year = readInteger(campos.periodoAno);
      // El año 0 es el centinela de «no lo dijo»: `lib/period.ts` lo infiere.
      return year > 0 ? { kind: "mes", month, year } : { kind: "mes", month };
    }

    case "ano": {
      const year = readInteger(campos.periodoAno);
      return year > 0 ? { kind: "ano", year } : DEFAULT_PERIOD;
    }

    case "rango": {
      const from = campos.periodoDesde;
      const to = campos.periodoHasta;
      // Un rango a medias no es un rango: mejor el mes en curso, que el usuario
      // ve nombrado en la respuesta, que media fecha inventada.
      return isRealDate(from) && isRealDate(to) ? { kind: "rango", from, to } : DEFAULT_PERIOD;
    }

    default:
      return { kind: token as Exclude<PeriodSpec["kind"], "ultimos_dias" | "mes" | "ano" | "rango"> };
  }
}

/**
 * El período con el que comparar.
 *
 * Si el modelo no lo dice, se deriva el anterior natural: «¿gasté más que el mes
 * pasado?» es la pregunta corriente y no debe fallar por un campo omitido.
 */
function readComparedPeriod(
  campos: Record<string, unknown>,
  base: PeriodSpec,
  now: Date,
): PeriodSpec | null {
  const token = campos.periodoComparado;

  if (typeof token === "string" && (PERIOD_TOKENS as readonly string[]).includes(token)) {
    // El segundo período usa los mismos campos auxiliares que el primero solo
    // cuando el primero no los necesita; en la práctica el modelo compara
    // etiquetas («este_mes» contra «mes_anterior»), que es lo que se soporta.
    if (token !== "rango" && token !== "ultimos_dias") {
      if (token === "mes" || token === "ano") {
        // Sin campos propios para el segundo mes, se cae al anterior natural.
        return previousPeriod(base, now);
      }
      return { kind: token as Exclude<PeriodSpec["kind"], "ultimos_dias" | "mes" | "ano" | "rango"> };
    }
  }

  return previousPeriod(base, now);
}

interface FilterRead {
  value: IntentFilters;
  /** Mensaje ya redactado si un término no está en el catálogo. */
  error?: string;
}

/**
 * Los filtros de clasificación, revalidados contra el catálogo.
 *
 * El `enum` del esquema ya restringe al modelo, pero se comprueba igual: confiar
 * en que el proveedor respete su propio contrato es exactamente la suposición que
 * rompe en producción. Es el mismo criterio que `matchCatalogue` en
 * `lib/suggest/gemini.ts`.
 */
function readFilters(campos: Record<string, unknown>, catalog: Catalog): FilterRead {
  const value: IntentFilters = {};

  const categoria = readTerm(campos.categoria);
  if (categoria) {
    const match = resolveCategoryMatch(catalog, categoria);
    if (match.estado !== "encontrada") {
      return { value, error: describeUnknownTerm(categoria, match) };
    }
    value.categoria = match.valor;
  }

  const resumen = readTerm(campos.categoriaResumen);
  if (resumen) {
    const match = resolveSummaryMatch(catalog, resumen);
    if (match.estado !== "encontrada") {
      return { value, error: describeUnknownTerm(resumen, match) };
    }
    value.categoriaResumen = match.valor as SummaryCategory;
  }

  const grupo = readTerm(campos.grupo);
  if (grupo) {
    const match = resolveGroupMatch(catalog, grupo);
    if (match.estado !== "encontrada") {
      return { value, error: describeUnknownTerm(grupo, match) };
    }
    value.grupo = match.valor as Group;
  }

  if (campos.sinCategoria === true) value.sinCategoria = true;

  // El comercio es TEXTO LIBRE: no hay catálogo de comercios que valga. No se usa
  // en ningún `.eq()`; el emparejamiento ocurre en memoria con el mismo
  // normalizador que la sugerencia de categoría. Se recorta por si acaso.
  const comercio = readTerm(campos.comercio);
  if (comercio) value.comercio = comercio.slice(0, 80);

  return { value };
}

/** Una cadena útil, o `undefined`. El centinela y el vacío valen lo mismo. */
function readTerm(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const limpio = value.trim();
  if (limpio === "" || limpio === CATALOG_NONE) return undefined;

  return limpio;
}

function readInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

/** El límite pedido, dentro de los topes. El 0 significa «no lo dijo». */
function readLimit(value: unknown, rango: { defecto: number; maximo: number }): number {
  const pedido = readInteger(value);
  if (pedido <= 0) return rango.defecto;
  return Math.min(pedido, rango.maximo);
}

function readOrder(value: unknown): ListOrder {
  return typeof value === "string" && (LIST_ORDERS as readonly string[]).includes(value)
    ? (value as ListOrder)
    : "recientes";
}

function readMetric(value: unknown): ComparisonMetric {
  return typeof value === "string" && (COMPARISON_METRICS as readonly string[]).includes(value)
    ? (value as ComparisonMetric)
    : "gastos";
}

/* -------------------------------------------------------------------------- */
/* Historial                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * La línea que el cliente guarda como turno del asistente.
 *
 * NO es la respuesta que se ve. Es un resumen corto y escrito por el servidor que
 * basta para que «¿y el mes anterior?» se entienda, y que mantiene fuera del
 * siguiente prompt el texto redactado —que salió de un modelo y puede arrastrar
 * el nombre de un comercio con instrucciones dentro—.
 */
export function historyNote(intent: Intent, period: ResolvedPeriod): string {
  const partes = [intent.intencion, period.label];

  const { categoria, categoriaResumen, grupo, comercio, sinCategoria } = intent.filtros;
  if (categoria) partes.push(`categoría ${categoria}`);
  if (categoriaResumen) partes.push(`resumen ${categoriaResumen}`);
  if (grupo) partes.push(`grupo ${grupo}`);
  if (comercio) partes.push(`comercio ${comercio}`);
  if (sinCategoria) partes.push("sin categoría");

  return partes.join(" · ");
}

/** El período de la intención, ya resuelto. Atajo para no repetirlo en la ruta. */
export function resolveIntentPeriod(intent: Intent, now: Date = new Date()): ResolvedPeriod {
  return resolvePeriod(intent.periodo, now);
}
