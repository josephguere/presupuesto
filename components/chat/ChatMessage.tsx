"use client";

import { formatCurrency } from "@/lib/format";
import { MAX_VISIBLE_ROWS } from "@/lib/ai/limits";
import type { ChatMessageItem, ChatResult, ChatResultRow } from "@/lib/chat/types";

/**
 * Una burbuja de la conversación.
 *
 * EL TEXTO DEL MODELO VA COMO TEXTO PLANO, dentro de un `<p>` con
 * `whitespace-pre-wrap` para respetar los saltos de línea. React lo escapa, así
 * que aunque la respuesta llegara con etiquetas HTML se verían como letras. Nada
 * de `dangerouslySetInnerHTML`: no hay renderizador de markdown en el proyecto y
 * este no es el sitio para estrenar uno con texto que ha pasado por un modelo.
 *
 * Las cifras las pinta `ChatResultTable` desde los NÚMEROS que manda el servidor,
 * no desde el texto. Es lo que garantiza que el importe de la tabla del chat y el
 * de la tabla de Movimientos se escriban igual: los formatea la misma función.
 */
export function ChatMessage({ message }: { message: ChatMessageItem }) {
  const esUsuario = message.role === "usuario";

  return (
    <li className={`flex flex-col gap-1.5 ${esUsuario ? "items-end" : "items-start"}`}>
      <div
        // El fallo se distingue por color Y por el borde, no solo por el color:
        // el rojo sobre gris no lo ve todo el mundo.
        className={`max-w-[92%] rounded-xl px-3 py-2 text-sm ${
          esUsuario
            ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
            : message.failed
              ? "border border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
              : "border border-zinc-200 bg-white text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
        }`}
        // Un fallo se anuncia; una respuesta normal ya la anuncia la lista.
        role={message.failed ? "alert" : undefined}
      >
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
      </div>

      {message.result && <ChatResultTable result={message.result} />}
    </li>
  );
}

/**
 * Las celdas de una fila, EXACTAMENTE tantas como cabeceras.
 *
 * El número de columnas lo decide el servidor y cambia con la intención: tres
 * para una lista o un desglose, dos para una respuesta de una sola cifra. Pintar
 * siempre tres dejaba la última cabecera encima de la columna del medio y las
 * cifras escalonadas, según cada fila trajera importe o recuento.
 *
 * Con dos columnas, el importe y el detalle comparten la segunda: nunca vienen
 * los dos a la vez en esa forma de respuesta.
 */
function cellsFor(row: ChatResultRow, columnas: number): string[] {
  const monto = row.amount === null || row.amount === undefined ? "" : formatCurrency(row.amount);
  const medio =
    row.detail ?? (row.count === null || row.count === undefined ? "" : String(row.count));

  return columnas >= 3 ? [row.label, medio, monto] : [row.label, monto || medio];
}

/**
 * La tabla de cifras que acompaña a una respuesta.
 *
 * Se recorta a `MAX_VISIBLE_ROWS` y se dice cuántas quedaron fuera. Callarlo haría
 * que una lista parcial pareciera completa, que es la clase de dato falso que
 * este chat no debe producir.
 */
export function ChatResultTable({ result }: { result: ChatResult }) {
  if (result.rows.length === 0) return null;

  const visibles = result.rows.slice(0, MAX_VISIBLE_ROWS);
  const ocultas = result.rows.length - visibles.length + (result.omitted ?? 0);

  return (
    <div className="w-full max-w-[92%] overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {/* La tabla se desplaza dentro de su caja; el panel nunca se desplaza en
          horizontal. */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              {result.columns.map((column, index) => (
                <th
                  key={column}
                  scope="col"
                  className={`px-2 py-1.5 font-medium ${
                    index === result.columns.length - 1 ? "text-right" : "text-left"
                  }`}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {visibles.map((row, index) => (
              <tr
                key={`${row.label}-${index}`}
                className={row.rest ? "text-zinc-500 italic dark:text-zinc-400" : undefined}
              >
                {cellsFor(row, result.columns.length).map((value, columna) => (
                  <td
                    key={columna}
                    className={
                      columna === 0
                        ? "px-2 py-1.5"
                        : columna === result.columns.length - 1
                          ? "px-2 py-1.5 text-right font-medium whitespace-nowrap tabular-nums"
                          : "px-2 py-1.5 text-zinc-500 tabular-nums dark:text-zinc-400"
                    }
                  >
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(ocultas > 0 || result.periodLabel) && (
        <p className="border-t border-zinc-200 px-2 py-1.5 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          {ocultas > 0 && `y ${ocultas} más. `}
          {result.periodLabel && `Período: ${result.periodLabel}.`}
        </p>
      )}
    </div>
  );
}
