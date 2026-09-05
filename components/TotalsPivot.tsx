"use client";

import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { GROUPS } from "@/lib/categories";
import { sortTotals, type TotalsOrder } from "@/lib/totals";
import type { TotalsNode } from "@/types/transaction";

/**
 * Totales del período, en tres niveles: grupo → categoría resumen → categoría.
 *
 * Sustituye a la tabla plana «Por categoría». Con veintinueve categorías, una
 * lista corrida obliga a sumar de cabeza para saber en qué se va el dinero; el
 * árbol responde esa pregunta de arriba abajo y deja el detalle a un clic.
 *
 * ES DE CLIENTE por dos cosas que no valen la pena en el servidor: plegar ramas
 * y cambiar el orden. Ambas son puramente visuales, no cambian qué movimientos
 * se están mirando, y hacerlas por URL costaría un viaje al servidor para
 * reordenar una lista que ya está en pantalla. Los filtros, que sí cambian los
 * datos, siguen viviendo en la URL.
 *
 * Los totales llegan calculados; aquí solo se ordenan y se pintan. Ordenar es
 * `sortTotals`, el mismo del servidor: la regla de «una categoría nunca sale de
 * su resumen» se cumple en un solo sitio.
 */
export function TotalsPivot({ nodes }: { nodes: TotalsNode[] }) {
  const [order, setOrder] = useState<TotalsOrder>("mayor");

  // Se guardan las ramas que el usuario ha CAMBIADO respecto a su estado por
  // defecto, no las abiertas ni las cerradas.
  //
  // Es lo que hace que el árbol se comporte al filtrar: si se guardaran las
  // abiertas, un grupo que aparezca tras cambiar de mes nacería cerrado; si se
  // guardaran las cerradas, una categoría resumen nueva nacería abierta. Con las
  // excepciones, cada rama nueva adopta el estado inicial que le toca y las
  // decisiones del usuario sobreviven.
  const [toggled, setToggled] = useState<Set<string>>(new Set());

  const ordered = useMemo(() => sortTotals(nodes, order), [nodes, order]);

  function toggle(key: string) {
    setToggled((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  if (nodes.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-3 py-2 sm:px-4 dark:border-zinc-800">
        <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          Grupo · Categoría resumen · Categoría
        </span>

        <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          Ordenar por
          <select
            value={order}
            onChange={(event) => setOrder(event.target.value as TotalsOrder)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          >
            <option value="mayor">Mayor monto</option>
            <option value="menor">Menor monto</option>
          </select>
        </label>
      </div>

      <table className="w-full text-sm">
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {ordered.map((group) => (
            <Branch key={group.key} node={group} level={0} toggled={toggled} onToggle={toggle} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Una rama y, si está abierta, las suyas.
 *
 * React admite devolver varias filas desde un fragmento, así que la recursión
 * produce una tabla plana con la jerarquía marcada por la sangría. Anidar
 * `<table>` dentro de `<td>` rompería la alineación de las columnas de importes,
 * que es justo lo que hace comparable un resumen.
 */
function Branch({
  node,
  level,
  toggled,
  onToggle,
}: {
  node: TotalsNode;
  level: number;
  toggled: Set<string>;
  onToggle: (key: string) => void;
}) {
  // Abierto = el estado por defecto, invertido si el usuario tocó esta rama.
  const isOpen = defaultOpen(node, level) !== toggled.has(node.key);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <tr className={level === 0 ? "bg-zinc-50/80 dark:bg-zinc-950/40" : undefined}>
        <td className="py-2 pr-2 pl-3 sm:pl-4">
          <button
            type="button"
            onClick={() => hasChildren && onToggle(node.key)}
            // Sin hijos no hay nada que plegar: deja de ser un botón a efectos
            // de teclado en vez de fingir que se puede pulsar.
            disabled={!hasChildren}
            aria-expanded={hasChildren ? isOpen : undefined}
            className={`flex w-full items-center gap-1.5 text-left ${
              hasChildren ? "cursor-pointer" : "cursor-default"
            } ${LEVEL_INDENT[level]} ${LEVEL_TEXT[level]}`}
          >
            <span
              aria-hidden="true"
              className={`w-3 shrink-0 text-[10px] text-zinc-400 ${hasChildren ? "" : "opacity-0"}`}
            >
              {isOpen ? "▼" : "▶"}
            </span>
            <span className="truncate">{node.label}</span>
          </button>
        </td>

        <td
          className={`px-2 py-2 text-right whitespace-nowrap tabular-nums ${LEVEL_TEXT[level]} text-zinc-500 dark:text-zinc-400`}
        >
          {node.count}
        </td>

        <td
          className={`py-2 pr-3 pl-2 text-right whitespace-nowrap tabular-nums sm:pr-4 ${LEVEL_TEXT[level]}`}
        >
          {formatCurrency(node.total)}
        </td>
      </tr>

      {isOpen &&
        node.children.map((child) => (
          <Branch
            key={child.key}
            node={child}
            level={level + 1}
            toggled={toggled}
            onToggle={onToggle}
          />
        ))}
    </>
  );
}

/**
 * Cómo nace cada rama al entrar o al recargar.
 *
 * Desplegado hasta CATEGORÍA RESUMEN: los grupos abiertos y sus resúmenes
 * cerrados. Es el nivel en el que se responde «¿en qué se me va el dinero?» sin
 * tener que leer veintinueve filas; el detalle por categoría queda a un clic.
 *
 * La rama de lo que no tiene categoría nace cerrada aunque esté en el nivel de
 * los grupos: no es un grupo, y abierta repite tres veces la misma palabra.
 *
 * No se recuerda entre visitas a propósito. Es estado de componente, así que
 * recargar o volver a entrar lo reinicia sin necesidad de borrar nada.
 */
function defaultOpen(node: TotalsNode, level: number): boolean {
  return level === 0 && (GROUPS as readonly string[]).includes(node.label);
}

/** Sangría por nivel. La jerarquía se lee por la posición, no por el color. */
const LEVEL_INDENT = ["pl-0", "pl-4", "pl-9"];

/** El peso tipográfico baja al bajar de nivel: el total del grupo manda. */
const LEVEL_TEXT = [
  "font-semibold text-zinc-900 dark:text-zinc-50",
  "font-medium text-zinc-800 dark:text-zinc-200",
  "text-zinc-600 dark:text-zinc-400",
];
