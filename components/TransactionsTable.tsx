import {
  formatCurrency,
  formatTransactionDate,
  formatTransactionTime,
  maskCard,
} from "@/lib/format";
import { NO_CATEGORY_LABEL } from "@/lib/categories";
import {
  amountSortArrow,
  amountSortLabel,
  nextAmountSort,
  type MovementSort,
} from "@/lib/movementSort";
import type { Transaction } from "@/types/transaction";
import { MovementDialog } from "./MovementDialog";
import { DeleteMovementButton } from "./DeleteMovementButton";
import { RestoreMovementButton } from "./RestoreMovementButton";

/**
 * Lista de movimientos.
 *
 * Se renderiza dos veces con los mismos datos: tarjetas apiladas en móvil y
 * tabla a partir de `lg`. Son trece columnas; meterlas en un scroll horizontal
 * dentro de un teléfono sería ilegible.
 *
 * TODO ES TEXTO. La tabla no edita nada, ni siquiera la categoría: mostrarla
 * como desplegable invitaba a cambiarla de un clic —y a cambiar la equivocada
 * al desplazarse con la rueda del ratón—. El único camino para modificar un
 * movimiento es «Editar», que abre el formulario completo y valida todo junto.
 *
 * La CATEGORÍA RESUMEN y el GRUPO se derivan de la categoría al leer, así que
 * aquí solo se pintan. Que viajen siempre juntos es lo que evita que la tabla y
 * los indicadores puedan contradecirse.
 *
 * El bloque de móvil NO cambia al añadir columnas: son dos maquetaciones
 * distintas para los mismos datos, no una tabla que se encoge.
 *
 * Todos los importes están ya en soles: la conversión desde dólares ocurre en la
 * ingesta, así que aquí no hay lógica de moneda ni columna que la muestre.
 */
export function TransactionsTable({
  transactions,
  actions = "edit",
  emptyMessage,
  amountSort,
}: {
  transactions: Transaction[];
  /**
   * Qué se puede hacer con cada fila.
   *
   * `edit` en Movimientos, `restore` en Eliminados y `none` en el Resumen, que
   * es solo de lectura.
   */
  actions?: "edit" | "restore" | "none";
  emptyMessage?: string;
  /**
   * Hace la cabecera «Monto» ordenable.
   *
   * Ausente —en el Resumen y en Eliminados— la cabecera es texto y la tabla no
   * cambia en nada.
   */
  amountSort?: {
    current: MovementSort;
    /** A dónde va cada orden, con los filtros actuales ya dentro. */
    hrefs: Record<MovementSort, string>;
  };
}) {
  const isTrash = actions === "restore";

  if (transactions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {emptyMessage ?? "Aún no hay movimientos."}
        </p>
        {!isTrash && (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
            Aparecerán aquí en cuanto llegue un correo del BCP, o créalos a mano.
          </p>
        )}
      </div>
    );
  }

  // El ancho de cada columna vive AQUÍ y en ningún otro sitio. Con `table-fixed`
  // las celdas lo heredan de su cabecera, así que encabezado y valores no pueden
  // desalinearse por mucho que cambie el contenido.
  //
  // Van en porcentajes y no en píxeles para que la tabla se reparta el ancho
  // que haya: si sobra sitio las columnas crecen, y si falta se recorta el texto
  // libre. Por debajo del `min-w` de la tabla ya no hay reparto que valga y
  // aparece la barra horizontal.
  const headings = [
    // Cabe «04 Set 2026» entero: la fecha no se recorta nunca.
    { label: "Fecha", width: "w-[9%]" },
    { label: "Hora", width: "w-[5%]" },
    { label: "Movimiento", width: "w-[8%]" },
    // Los tres niveles de la jerarquía, del más general al más concreto.
    { label: "Categoría resumen", width: "w-[9%]" },
    { label: "Categoría", width: "w-[9%]" },
    // Tiene que caber «GASTOS VARIABLES», aunque sea en dos líneas.
    { label: "Grupo", width: "w-[8%]" },
    { label: "Tipo", width: "w-[8%]" },
    // Estas dos van pegadas y las dos son numéricas: si se quedan cortas, sus
    // valores se tocan y se leen como un solo número.
    { label: "Tarjeta", width: "w-[6%]" },
    { label: "N° operación", width: "w-[7%]" },
    { label: "Comentario", width: "w-[9%]" },
    { label: "Origen", width: "w-[6%]" },
  ];

  return (
    <>
      {/* Móvil */}
      <ul className="space-y-2 lg:hidden">
        {transactions.map((transaction) => (
          <li
            key={transaction.id}
            className="rounded-xl border border-zinc-200 bg-white p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-900 dark:text-zinc-50">
                  {transaction.merchant}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {formatTransactionDate(transaction.transactionAt)}
                  {formatTransactionTime(transaction.transactionAt) &&
                    ` · ${formatTransactionTime(transaction.transactionAt)}`}
                </p>
              </div>
              <p className="shrink-0 font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {formatCurrency(transaction.amount)}
              </p>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
              <OriginBadge origin={transaction.origin} />
              <span className="truncate">{transaction.operationType}</span>
              <span className="tabular-nums">{maskCard(transaction.cardLast4)}</span>
              {transaction.operationNumber && (
                <span className="tabular-nums">N° {transaction.operationNumber}</span>
              )}
            </div>

            {transaction.comment && (
              <p className="mt-2 text-xs text-zinc-600 italic dark:text-zinc-400">
                {transaction.comment}
              </p>
            )}

            {isTrash && transaction.deletedAt && (
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
                Eliminado el {formatTransactionDate(transaction.deletedAt)}
                {formatTransactionTime(transaction.deletedAt) &&
                  ` · ${formatTransactionTime(transaction.deletedAt)}`}
              </p>
            )}

            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <CategoryLabel category={transaction.category} />
                <GroupLabel group={transaction.group} />
              </div>

              <RowActions transaction={transaction} actions={actions} />
            </div>
          </li>
        ))}
      </ul>

      {/* Escritorio */}
      <div className="hidden overflow-x-auto rounded-xl border border-zinc-200 bg-white lg:block dark:border-zinc-800 dark:bg-zinc-900">
        {/* `table-fixed`: las columnas obedecen el ancho declarado en lugar de
            estirarse con su contenido. Es lo que hace que `truncate` funcione
            dentro de una celda — con el reparto automático no funciona.

            `min-w-[88rem]`: por debajo de 1408 px, TRECE columnas no caben sin
            que los valores se toquen. Y hay tres que NO se pueden recortar sin
            mentir —fecha, número de operación y monto—, así que llegado ese
            punto es preferible desplazarse en horizontal a leer «S/ 1,250.5…».
            El suelo subió al añadir «Categoría resumen»: cada columna nueva lo
            empuja hacia arriba, y con trece ya no hay reparto que las meta a
            todas en una pantalla de 1280 px. */}
        <table className="w-full min-w-[88rem] table-fixed text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
              {headings.map((heading) => (
                <th
                  key={heading.label}
                  scope="col"
                  className={`${headingClass} ${heading.width}`}
                >
                  {heading.label}
                </th>
              ))}
              <th
                scope="col"
                aria-sort={ariaSortFor(amountSort?.current)}
                className={`${headingClass} w-[8%] text-right`}
              >
                {amountSort ? (
                  // Un enlace y no un botón: esto NAVEGA —el orden vive en la
                  // URL—, así que funciona sin JavaScript y se puede compartir.
                  <a
                    href={amountSort.hrefs[nextAmountSort(amountSort.current)]}
                    aria-label={amountSortLabel(amountSort.current)}
                    className="flex cursor-pointer items-center justify-end gap-1 hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    Monto
                    <span aria-hidden="true" className="w-2 text-[10px]">
                      {amountSortArrow(amountSort.current)}
                    </span>
                  </a>
                ) : (
                  "Monto"
                )}
              </th>
              {isTrash && (
                <th scope="col" className={`${headingClass} w-[9%]`}>
                  Eliminado el
                </th>
              )}
              {actions !== "none" && (
                <th scope="col" className={`${headingClass} w-[8%] text-right`}>
                  Acciones
                </th>
              )}
            </tr>
          </thead>

          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {transactions.map((transaction) => (
              <tr key={transaction.id}>
                <td className={`${cellClass} whitespace-nowrap`}>
                  {formatTransactionDate(transaction.transactionAt)}
                </td>
                <td className={`${cellClass} tabular-nums whitespace-nowrap`}>
                  {formatTransactionTime(transaction.transactionAt) || "—"}
                </td>
                <td
                  className="truncate px-3 py-3 font-medium text-zinc-900 dark:text-zinc-50"
                  title={transaction.merchant}
                >
                  {transaction.merchant}
                </td>
                <td className={`${cellClass} truncate`} title={transaction.summary ?? ""}>
                  {transaction.summary ?? "—"}
                </td>
                <td className="px-3 py-3">
                  <CategoryLabel category={transaction.category} />
                </td>
                <td className="px-3 py-3">
                  <GroupLabel group={transaction.group} />
                </td>
                <td className={`${cellClass} truncate`} title={transaction.operationType}>
                  {transaction.operationType}
                </td>
                <td className={`${cellClass} tabular-nums`}>{maskCard(transaction.cardLast4)}</td>
                <td className={`${cellClass} tabular-nums`}>
                  {transaction.operationNumber ?? "—"}
                </td>
                <td className={`${cellClass} truncate`} title={transaction.comment ?? ""}>
                  {transaction.comment ?? "—"}
                </td>
                <td className="px-3 py-3">
                  <OriginBadge origin={transaction.origin} />
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums whitespace-nowrap text-zinc-900 dark:text-zinc-50">
                  {formatCurrency(transaction.amount)}
                </td>

                {isTrash && (
                  <td className={`${cellClass} whitespace-nowrap`}>
                    {transaction.deletedAt
                      ? `${formatTransactionDate(transaction.deletedAt)} ${formatTransactionTime(
                          transaction.deletedAt,
                        )}`.trim()
                      : "—"}
                  </td>
                )}

                {actions !== "none" && (
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <RowActions transaction={transaction} actions={actions} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const headingClass =
  "px-3 py-3 text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400";

const cellClass = "px-3 py-3 text-zinc-600 dark:text-zinc-400";

/**
 * Estado de orden para lectores de pantalla.
 *
 * `aria-sort` solo debe ir en la columna por la que se está ordenando; ponerlo
 * en «none» siempre haría creer que la tabla está sin ordenar.
 */
function ariaSortFor(sort: MovementSort | undefined): "ascending" | "descending" | undefined {
  if (sort === "monto-asc") return "ascending";
  if (sort === "monto-desc") return "descending";
  return undefined;
}

/** Botones de la fila. En la papelera no se edita: solo se restaura. */
function RowActions({
  transaction,
  actions,
}: {
  transaction: Transaction;
  actions: "edit" | "restore" | "none";
}) {
  if (actions === "none") return null;

  if (actions === "restore") {
    return (
      <RestoreMovementButton transactionId={transaction.id} label={transaction.merchant} />
    );
  }

  return (
    <div className="flex shrink-0 items-center justify-end gap-3">
      <MovementDialog transaction={transaction} trigger="link" />
      <DeleteMovementButton transactionId={transaction.id} label={transaction.merchant} />
    </div>
  );
}

/**
 * Categoría como texto.
 *
 * «Sin categoría» se pinta en gris y con borde discontinuo para que salte a la
 * vista lo que falta por clasificar sin necesidad de leer cada fila.
 */
function CategoryLabel({ category }: { category: string | null }) {
  if (!category) {
    return (
      <span className="rounded-md border border-dashed border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        {NO_CATEGORY_LABEL}
      </span>
    );
  }

  return <span className="text-zinc-900 dark:text-zinc-100">{category}</span>;
}

/** Grupo como texto. Derivado de la categoría, nunca editable. */
function GroupLabel({ group }: { group: string | null }) {
  if (!group) return <span className="text-xs text-zinc-400 dark:text-zinc-600">—</span>;

  const isIncome = group === "INGRESOS";

  return (
    <span
      // El badge lo comparten las tarjetas de móvil y la tabla, así que el
      // permiso para partirse va limitado a `lg`: en la columna estrecha de la
      // tabla, «GASTOS VARIABLES» pasa a dos líneas en vez de quedar recortado,
      // y en móvil se sigue viendo exactamente como antes.
      className={`rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap lg:whitespace-normal ${
        isIncome
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
      }`}
    >
      {group}
    </span>
  );
}

/** EMAIL o MANUAL, en una etiqueta pequeña para distinguirlos de un vistazo. */
function OriginBadge({ origin }: { origin: string }) {
  const isEmail = origin === "EMAIL";
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${
        isEmail
          ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          : "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"
      }`}
    >
      {origin}
    </span>
  );
}
