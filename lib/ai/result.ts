import { formatCurrency, formatTransactionDate } from "@/lib/format";
import type { PeriodKind } from "@/lib/period";
import type { IntentFilters, IntentName, ListOrder } from "./intent";

/**
 * La forma ÚNICA del resultado de una consulta del chat.
 *
 * AQUÍ ESTÁ LA LISTA DE LO QUE PUEDE SALIR. No hay `id`, ni `card_last4`, ni
 * `operation_number`, ni `comment`, ni nada del correo original. Lo que no está
 * en estos tipos no puede llegar ni al modelo ni al navegador, y esa es una
 * garantía mucho más fuerte que acordarse de no incluirlos al construir cada
 * respuesta.
 *
 * CADA IMPORTE VIAJA DOS VECES: `valor` numérico y `texto` ya formateado. No es
 * duplicación por descuido, son dos destinos con necesidades opuestas:
 *
 *   · Al MODELO va solo `texto`. Si no recibe números, no puede sumarlos mal.
 *   · Al NAVEGADOR va solo `valor`, y lo formatea `formatCurrency` con el mismo
 *     formateador que la tabla de Movimientos, para que las dos cifras coincidan.
 *
 * Módulo puro: no importa Supabase, así que la ruta y los prompts pueden usar
 * estos tipos sin arrastrar el cliente admin.
 */

export interface PeriodoAplicado {
  tipo: PeriodKind;
  /** «septiembre de 2026 (mes en curso, hasta el día 5)». */
  etiqueta: string;
  desde: string | null;
  hasta: string | null;
}

/** Un número con nombre: el total, el balance, el recuento. */
export interface Metrica {
  clave: string;
  etiqueta: string;
  valor: number;
  /** Ya con `formatCurrency` si es dinero. Es lo único que ve el modelo. */
  texto: string;
  unidad: "PEN" | "movimientos" | "porcentaje";
}

/** Una fila de una lista o de un desglose. */
export interface FilaResultado {
  etiqueta: string;
  total: number;
  texto: string;
  movimientos: number;
  /** Solo en listas de movimientos. */
  fecha?: string;
  comercio?: string;
  categoria?: string | null;
  resumen?: string | null;
  grupo?: string | null;
  porcentaje?: number;
  /** Fila sintética que reúne la cola recortada. */
  esResto?: boolean;
}

/** Los filtros que de verdad se aplicaron, para poder contarlos en la respuesta. */
export interface FiltrosAplicados extends IntentFilters {
  /** Cómo se emparejó el comercio: importa para explicar qué se sumó. */
  comercioCoincidencia?: "exacta" | "familia" | "parcial";
  nivel?: "categoria" | "resumen";
  orden?: ListOrder;
}

export interface ExecutionResult {
  intencion: IntentName;
  periodo: PeriodoAplicado;
  periodoComparado?: PeriodoAplicado;
  filtros: FiltrosAplicados;
  /** Ordenadas: la PRIMERA es la respuesta a la pregunta. */
  metricas: Metrica[];
  filas: FilaResultado[];
  /** Cuántas filas había antes de recortar. */
  totalFilas: number;
  filasOmitidas: number;
  vacio: boolean;
  /** La lectura tocó el tope: el total podría quedarse corto. */
  truncado: boolean;
  /** Frases del servidor que la redacción debe tener en cuenta. */
  avisos: string[];
}

/* -------------------------------------------------------------------------- */
/* Constructores                                                               */
/* -------------------------------------------------------------------------- */

/** Los importes se redondean al construir, no al pintar. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function metricaMonto(clave: string, etiqueta: string, valor: number): Metrica {
  const redondeado = round2(valor);
  return {
    clave,
    etiqueta,
    valor: redondeado,
    texto: formatCurrency(redondeado),
    unidad: "PEN",
  };
}

export function metricaConteo(clave: string, etiqueta: string, valor: number): Metrica {
  return {
    clave,
    etiqueta,
    valor,
    texto: `${valor} ${valor === 1 ? "movimiento" : "movimientos"}`,
    unidad: "movimientos",
  };
}

export function metricaPorcentaje(
  clave: string,
  etiqueta: string,
  valor: number | null,
): Metrica {
  // Sin base no hay porcentaje. Se dice, en lugar de escribir un 0 % que
  // parecería un dato real.
  if (valor === null || !Number.isFinite(valor)) {
    return { clave, etiqueta, valor: 0, texto: "no aplica", unidad: "porcentaje" };
  }

  const redondeado = Math.round(valor * 10) / 10;
  const signo = redondeado > 0 ? "+" : "";
  return {
    clave,
    etiqueta,
    valor: redondeado,
    texto: `${signo}${redondeado.toString().replace(".", ",")} %`,
    unidad: "porcentaje",
  };
}

/**
 * La fecha de un movimiento, en hora de Lima.
 *
 * Se pasa por `formatTransactionDate`, que es el mismo formateador de la tabla:
 * dos formas distintas de escribir la misma fecha en la misma pantalla se leen
 * como dos fechas distintas.
 */
export function etiquetaFecha(iso: string | null): string {
  return formatTransactionDate(iso);
}
