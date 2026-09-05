import type { TotalsNode, Transaction } from "@/types/transaction";

/**
 * Agregación de la tabla dinámica del resumen.
 *
 * Vive aparte de `transactions.ts` porque es PURO: entra una lista de
 * movimientos, sale un árbol de totales. Eso permite usarlo en el servidor para
 * construirlo y en el navegador para reordenarlo, mientras que `transactions.ts`
 * importa el cliente de Supabase y no puede cruzar al cliente.
 */

/** Los importes se redondean al sumar para no arrastrar errores de coma flotante. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Cómo se ordenan los totales del resumen. */
export type TotalsOrder = "mayor" | "menor";

/** Etiqueta de la fila que reúne lo que aún no tiene categoría. */
const UNCATEGORIZED_LABEL = "Sin categoría";

/**
 * Tabla dinámica del resumen: grupo → categoría resumen → categoría.
 *
 * Los totales se calculan aquí, sobre los movimientos ya filtrados, y no se
 * guardan en ninguna parte: un total almacenado se desincroniza en cuanto se
 * edita un movimiento.
 *
 * Se suma de ABAJO ARRIBA. El total de una categoría resumen es la suma de sus
 * categorías, y el de un grupo la de sus resúmenes, de modo que los tres niveles
 * cuadran por construcción. Sumar cada nivel por separado recorriendo la lista
 * daría los mismos números hoy y permitiría que dejaran de cuadrar mañana.
 *
 * Lo que no tiene categoría no se reparte: cae en su propia rama, porque
 * repartirlo daría totales que parecen correctos sin serlo.
 */
export function buildGroupedTotals(
  transactions: Transaction[],
  order: TotalsOrder = "mayor",
): TotalsNode[] {
  // grupo → resumen → categoría → acumulado
  const groups = new Map<string, Map<string, Map<string, { total: number; count: number }>>>();

  for (const transaction of transactions) {
    const group = transaction.group ?? UNCATEGORIZED_LABEL;
    const summary = transaction.summary ?? UNCATEGORIZED_LABEL;
    const category = transaction.category ?? UNCATEGORIZED_LABEL;

    const summaries = groups.get(group) ?? new Map();
    groups.set(group, summaries);

    const categories = summaries.get(summary) ?? new Map();
    summaries.set(summary, categories);

    const current = categories.get(category) ?? { total: 0, count: 0 };
    categories.set(category, {
      total: round2(current.total + transaction.amount),
      count: current.count + 1,
    });
  }

  const tree: TotalsNode[] = [];

  for (const [group, summaries] of groups) {
    const summaryNodes: TotalsNode[] = [];

    for (const [summary, categories] of summaries) {
      const categoryNodes: TotalsNode[] = [];

      for (const [category, acumulado] of categories) {
        categoryNodes.push({
          label: category,
          key: `${group}/${summary}/${category}`,
          total: acumulado.total,
          count: acumulado.count,
          children: [],
        });
      }

      summaryNodes.push(rollUp(summary, `${group}/${summary}`, categoryNodes));
    }

    tree.push(rollUp(group, group, summaryNodes));
  }

  return sortTotals(tree, order);
}

/** Un nodo cuyo total y cuenta son la suma de sus hijos. */
function rollUp(label: string, key: string, children: TotalsNode[]): TotalsNode {
  return {
    label,
    key,
    total: round2(children.reduce((sum, child) => sum + child.total, 0)),
    count: children.reduce((sum, child) => sum + child.count, 0),
    children,
  };
}

/**
 * Ordena por importe DENTRO de cada nivel, nunca entre niveles.
 *
 * Devuelve un árbol nuevo: el original no se toca, así que reordenar en el
 * navegador no puede corromper lo que llegó del servidor.
 *
 * Es lo que garantiza que una categoría no pueda aparecer fuera de su resumen ni
 * un resumen fuera de su grupo: la recursión ordena hermanos y solo hermanos.
 */
export function sortTotals(nodes: TotalsNode[], order: TotalsOrder): TotalsNode[] {
  const signo = order === "mayor" ? -1 : 1;

  return [...nodes]
    .sort((a, b) => signo * (a.total - b.total))
    .map((node) => ({ ...node, children: sortTotals(node.children, order) }));
}

/** `mayor` si el valor no es uno de los dos órdenes admitidos. */
export function parseTotalsOrder(value: string | string[] | undefined): TotalsOrder {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "menor" ? "menor" : "mayor";
}

