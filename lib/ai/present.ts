import { MAX_ROWS_TO_MODEL } from "./limits";
import type { ExecutionResult, FiltrosAplicados } from "./result";
import type { IntentName } from "./intent";
import type { ChatResult, ChatResultRow } from "@/lib/chat/types";

/**
 * Las dos proyecciones del resultado. Una hacia el modelo, otra hacia el
 * navegador, y son deliberadamente distintas.
 *
 *   · HACIA GEMINI van solo CADENAS ya formateadas. Si no recibe números, no
 *     puede sumarlos, restarlos ni sacar porcentajes: solo puede copiar los que
 *     le damos. La aritmética ya está hecha por el servidor.
 *   · HACIA EL NAVEGADOR van solo NÚMEROS, y los formatea `formatCurrency` con
 *     el mismo formateador que la tabla de Movimientos. Si viajaran escritos por
 *     el modelo, un despiste suyo con las comas mostraría una cifra distinta a la
 *     de la pantalla de al lado.
 *
 * Es también el único módulo que sabe qué cabeceras de tabla corresponden a cada
 * una de las doce intenciones.
 */

export interface AnswerFact {
  etiqueta: string;
  /** YA formateado. El modelo no ve un solo número suelto. */
  valor: string;
}

export interface AnswerRow {
  etiqueta: string;
  detalle: string;
  monto: string;
}

export interface AnswerPayload {
  intencion: IntentName;
  periodo: string;
  periodoComparado: string | null;
  filtros: string[];
  /** Totales, balances y recuentos, en orden: el primero responde la pregunta. */
  hechos: AnswerFact[];
  /** Como mucho `MAX_ROWS_TO_MODEL`, ya formateadas. */
  filas: AnswerRow[];
  totalFilas: number;
  sinDatos: boolean;
  /**
   * Advertencias sobre los DATOS, dirigidas al usuario.
   *
   * «La consulta alcanzó el tope de movimientos», «no hay movimientos de ese
   * comercio». Se pueden leer en voz alta: si la redacción falla y responde el
   * servidor, estas frases salen tal cual en pantalla.
   */
  avisos: string[];
  /**
   * Instrucciones para el MODELO. Nunca se pintan.
   *
   * Van aparte de `avisos` por eso mismo: son órdenes del prompt («no afirmes
   * que es la lista completa»), e imprimirlas en la burbuja del chat sería
   * enseñarle al usuario las tripas del sistema. `buildDeterministicAnswer` no
   * las mira.
   */
  notasModelo: string[];
}

/* -------------------------------------------------------------------------- */
/* Hacia el modelo                                                             */
/* -------------------------------------------------------------------------- */

export function toAnswerPayload(result: ExecutionResult): AnswerPayload {
  const visibles = result.filas.slice(0, MAX_ROWS_TO_MODEL);

  const notasModelo: string[] = [];
  if (result.filas.length > visibles.length) {
    notasModelo.push(
      `Solo se muestran ${visibles.length} de ${result.filas.length} filas; no afirmes que es la lista completa.`,
    );
  }
  if (result.filasOmitidas > 0) {
    notasModelo.push(`Hay ${result.filasOmitidas} filas agrupadas en la fila de resto.`);
  }

  return {
    notasModelo,
    intencion: result.intencion,
    periodo: result.periodo.etiqueta,
    periodoComparado: result.periodoComparado?.etiqueta ?? null,
    filtros: describeFilters(result.filtros),
    hechos: result.metricas.map((metrica) => ({
      etiqueta: metrica.etiqueta,
      valor: metrica.texto,
    })),
    filas: visibles.map((fila) => ({
      etiqueta: fila.etiqueta,
      detalle: rowDetail(fila.fecha, fila.categoria, fila.movimientos, fila.porcentaje),
      monto: fila.texto,
    })),
    totalFilas: result.totalFilas,
    sinDatos: result.vacio,
    avisos: result.avisos,
  };
}

/** El detalle de una fila, en una sola cadena para no inflar el prompt. */
function rowDetail(
  fecha: string | undefined,
  categoria: string | null | undefined,
  movimientos: number,
  porcentaje: number | undefined,
): string {
  const partes: string[] = [];

  if (fecha) partes.push(fecha);
  if (categoria) partes.push(categoria);
  else if (fecha) partes.push("sin categoría");

  if (!fecha) {
    partes.push(`${movimientos} ${movimientos === 1 ? "movimiento" : "movimientos"}`);
    if (porcentaje !== undefined) partes.push(`${porcentaje.toString().replace(".", ",")} %`);
  }

  return partes.join(" · ");
}

/** Los filtros aplicados, en cristiano, para que la respuesta pueda nombrarlos. */
function describeFilters(filtros: FiltrosAplicados): string[] {
  const partes: string[] = [];

  if (filtros.categoria) partes.push(`categoría ${filtros.categoria}`);
  if (filtros.categoriaResumen) partes.push(`categoría resumen ${filtros.categoriaResumen}`);
  if (filtros.grupo) partes.push(`grupo ${filtros.grupo}`);
  if (filtros.sinCategoria) partes.push("solo movimientos sin categoría");

  if (filtros.comercio) {
    // Cómo se emparejó importa: con «familia» se sumaron variantes del mismo
    // nombre, y decirlo evita que el usuario piense que falta algo o que sobra.
    const como =
      filtros.comercioCoincidencia === "familia"
        ? " (todas las variantes del nombre)"
        : filtros.comercioCoincidencia === "parcial"
          ? " (coincidencia parcial del nombre)"
          : "";
    partes.push(`comercio ${filtros.comercio}${como}`);
  }

  return partes;
}

/* -------------------------------------------------------------------------- */
/* Hacia el navegador                                                          */
/* -------------------------------------------------------------------------- */

/**
 * La tabla que acompaña a la respuesta.
 *
 * `null` cuando no hay nada que tabular: fuera de alcance, período sin datos, o
 * una intención que se responde con una sola cifra. Una tabla de una fila con la
 * misma cifra que la frase es ruido.
 */
export function toChatResult(result: ExecutionResult): ChatResult | null {
  if (result.vacio) return null;

  const rows: ChatResultRow[] = result.filas.map((fila) => ({
    label: fila.etiqueta,
    detail: fila.fecha ?? (fila.categoria || null),
    amount: fila.total,
    count: fila.fecha ? null : fila.movimientos,
    rest: fila.esResto,
  }));

  // Sin filas, las métricas SON la tabla: así «¿cuánto gasté este mes?» enseña
  // el total, los movimientos y los ingresos en vez de solo una frase.
  if (rows.length === 0) {
    if (result.metricas.length === 0) return null;

    return {
      intent: result.intencion,
      columns: ["Concepto", "Valor"],
      rows: result.metricas.map((metrica) => ({
        label: metrica.etiqueta,
        amount: metrica.unidad === "PEN" ? metrica.valor : null,
        detail: metrica.unidad === "PEN" ? null : metrica.texto,
      })),
      periodLabel: result.periodo.etiqueta,
      omitted: 0,
    };
  }

  // El total, no la primera cifra que aparezca: en un desglose la primera
  // métrica es «Mayor: …», y ponerla como total de la tabla haría que el pie
  // contradijera a la suma de las filas que tiene encima.
  const total =
    result.metricas.find((metrica) => metrica.clave === "total") ??
    result.metricas.find((metrica) => metrica.unidad === "PEN");

  return {
    intent: result.intencion,
    columns: columnsFor(result.intencion, result.filtros),
    rows,
    total: total?.valor ?? null,
    periodLabel: result.periodo.etiqueta,
    omitted: result.filasOmitidas,
  };
}

/** Las dos o tres cabeceras que corresponden a la intención. */
export function columnsFor(intent: IntentName, filtros: FiltrosAplicados): string[] {
  switch (intent) {
    case "transaction_list":
    case "highest_transactions":
      return ["Movimiento", "Fecha", "Monto"];

    case "group_breakdown":
      return ["Grupo", "Movimientos", "Monto"];

    case "category_breakdown":
      return [
        filtros.nivel === "resumen" ? "Categoría resumen" : "Categoría",
        "Movimientos",
        "Monto",
      ];

    case "period_comparison":
      return ["Período", "Movimientos", "Monto"];

    default:
      return ["Concepto", "Movimientos", "Monto"];
  }
}
