import Link from "next/link";
import { redirect } from "next/navigation";
import { hasValidSession } from "@/lib/auth/guard";
import { SetupNotice } from "@/components/SetupNotice";
import { PageContainer } from "@/components/PageContainer";
import { GoalDialog } from "@/components/GoalDialog";
import { DeleteGoalButton } from "@/components/DeleteGoalButton";
import { GoalProgressBar, formatPercent } from "@/components/GoalProgressBar";
import { GoalsFilterBar } from "@/components/GoalsFilterBar";
import {
  buildGoalProgress,
  getGoalMonths,
  getGoals,
  summarizeGoals,
  type GoalProgress,
} from "@/lib/goals";
import {
  getCurrentMonth,
  getTransactions,
  isValidMonth,
  parseFilters,
} from "@/lib/transactions";
import { getGroupForCategory, getSummaryForCategory } from "@/lib/categories";
import { formatCurrency, formatMonthLabel } from "@/lib/format";
import { describeError } from "@/lib/logger";

/**
 * Metas: cuánto quiero gastar este mes en cada categoría, y cuánto llevo.
 *
 * EL GASTO SE CALCULA, no se guarda. Sale de los mismos movimientos que alimentan
 * el Resumen, leídos con los mismos filtros —activos y contabilizados—, así que
 * el «gastado» de una meta y el total de esa categoría en el Resumen son
 * necesariamente la misma cifra. Guardarlo se desincronizaría en cuanto se
 * editara un movimiento.
 *
 * LAS METAS SON POR MES. Cambiar de mes arriba carga las de ese mes; septiembre
 * y octubre son independientes, y una categoría puede tener meta en uno y no en
 * el otro.
 *
 * Los filtros de grupo, categoría resumen y categoría son los mismos combos de
 * selección múltiple que en Resumen y Movimientos, pero aquí filtran QUÉ METAS
 * se listan —no qué movimientos—, así que se aplican en memoria sobre una lista
 * que rara vez pasa de treinta filas.
 */

export const dynamic = "force-dynamic";

export default async function MetasPage(props: PageProps<"/metas">) {
  // El proxy ya corta antes de llegar aquí; esto es la segunda cerradura,
  // en el mismo proceso que lee los datos.
  if (!(await hasValidSession())) redirect("/login");

  const searchParams = await props.searchParams;
  const parsed = parseFilters(searchParams);
  const { raw } = parsed;

  // Las metas siempre miran UN mes concreto: sin mes no hay con qué comparar.
  // Por eso aquí no existe «Todos los meses» y el valor por defecto es el actual.
  const month = isValidMonth(raw.month) ? raw.month : getCurrentMonth();

  let progress: GoalProgress[] = [];
  let months: string[] = [];
  let error: string | null = null;

  try {
    const [goals, transactions, goalMonths] = await Promise.all([
      getGoals(month),
      // Los MISMOS filtros que el resto de la aplicación: `getTransactions`
      // excluye por defecto los eliminados y los no contabilizados.
      getTransactions({ month }),
      getGoalMonths(),
    ]);

    progress = buildGoalProgress(goals, transactions);
    months = goalMonths;
  } catch (caught) {
    error = describeError(caught);
  }

  const visible = filterProgress(progress, raw);
  const totals = summarizeGoals(visible);
  const usedCategories = progress.map((goal) => goal.category);

  return (
    <PageContainer className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Metas</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {error
              ? "Metas de gasto por categoría."
              : `${formatMonthLabel(month)} · ${visible.length} ${
                  visible.length === 1 ? "meta" : "metas"
                }`}
          </p>
        </div>

        {!error && (
          <GoalDialog trigger="primary" month={month} usedCategories={usedCategories} />
        )}
      </div>

      {error ? (
        <SetupNotice message={error} />
      ) : (
        <>
          <GoalsFilterBar
            months={months}
            values={{ ...raw, month }}
          />

          {visible.length > 0 && <GoalsTotals totals={totals} />}

          {visible.length === 0 ? (
            <EmptyState hasGoals={progress.length > 0} month={month} />
          ) : (
            <>
              {/* Móvil: una tarjeta por meta. La tabla de seis columnas no cabe
                  en un teléfono sin recortar los importes, que es justo lo que
                  no se puede recortar. */}
              <ul className="space-y-3 lg:hidden">
                {visible.map((goal) => (
                  <li
                    key={goal.id}
                    className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-zinc-900 dark:text-zinc-50">
                          {goal.category}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                          {getSummaryForCategory(goal.category)} ·{" "}
                          {goal.movimientos}{" "}
                          {goal.movimientos === 1 ? "movimiento" : "movimientos"}
                        </p>
                      </div>
                      <Disponible value={goal.disponible} />
                    </div>

                    <div className="mt-3">
                      <GoalProgressBar
                        gastado={goal.gastado}
                        meta={goal.amount}
                        porcentaje={goal.porcentaje}
                      />
                    </div>

                    <div className="mt-3 flex items-center justify-end gap-3">
                      <GoalDialog
                        trigger="link"
                        goal={goal}
                        month={month}
                        usedCategories={usedCategories}
                      />
                      <DeleteGoalButton goalId={goal.id} label={goal.category} />
                    </div>
                  </li>
                ))}
              </ul>

              {/* Escritorio */}
              <div className="hidden overflow-hidden rounded-xl border border-zinc-200 bg-white lg:block dark:border-zinc-800 dark:bg-zinc-900">
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                      <th scope="col" className={`${headingClass} w-[20%]`}>
                        Categoría
                      </th>
                      <th scope="col" className={`${headingClass} w-[14%]`}>
                        Categoría resumen
                      </th>
                      <th scope="col" className={`${headingClass} w-[11%] text-right`}>
                        Meta
                      </th>
                      <th scope="col" className={`${headingClass} w-[11%] text-right`}>
                        Gastado
                      </th>
                      <th scope="col" className={`${headingClass} w-[11%] text-right`}>
                        Disponible
                      </th>
                      <th scope="col" className={`${headingClass} w-[21%]`}>
                        Progreso
                      </th>
                      <th scope="col" className={`${headingClass} w-[12%] text-right`}>
                        Acciones
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {visible.map((goal) => (
                      <tr key={goal.id}>
                        <td className="truncate px-3 py-3 font-medium text-zinc-900 dark:text-zinc-50">
                          {goal.category}
                        </td>
                        <td className={`${cellClass} truncate`}>
                          {getSummaryForCategory(goal.category) ?? "—"}
                        </td>
                        <td className={`${cellClass} text-right tabular-nums whitespace-nowrap`}>
                          {formatCurrency(goal.amount)}
                        </td>
                        <td className={`${cellClass} text-right tabular-nums whitespace-nowrap`}>
                          {formatCurrency(goal.gastado)}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <Disponible value={goal.disponible} />
                        </td>
                        <td className="px-3 py-3">
                          <GoalProgressBar
                            gastado={goal.gastado}
                            meta={goal.amount}
                            porcentaje={goal.porcentaje}
                          />
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-3">
                            <GoalDialog
                              trigger="link"
                              goal={goal}
                              month={month}
                              usedCategories={usedCategories}
                            />
                            <DeleteGoalButton goalId={goal.id} label={goal.category} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </PageContainer>
  );
}

/**
 * Filtra las metas por grupo, resumen y categoría.
 *
 * En memoria y no en la consulta a propósito: las metas de un mes son unas
 * pocas decenas de filas, y los tres niveles se derivan de la categoría en
 * TypeScript —no existen como columnas—, así que filtrarlos en SQL exigiría
 * duplicar el catálogo dentro de la consulta.
 *
 * Está fuera del componente para poder probarla sin renderizar la página.
 */
export function filterProgress(
  progress: GoalProgress[],
  raw: { categories: string[]; summaries: string[]; groups: string[] },
): GoalProgress[] {
  return progress.filter((goal) => {
    if (raw.groups.length > 0 && !raw.groups.includes(getGroupForCategory(goal.category) ?? "")) {
      return false;
    }

    if (
      raw.summaries.length > 0 &&
      !raw.summaries.includes(getSummaryForCategory(goal.category) ?? "")
    ) {
      return false;
    }

    if (raw.categories.length > 0 && !raw.categories.includes(goal.category)) return false;

    return true;
  });
}

/** Lo que queda, en verde; lo que sobra, en rojo y con signo. */
function Disponible({ value }: { value: number }) {
  const excedido = value < 0;

  return (
    <span
      className={`font-semibold tabular-nums whitespace-nowrap ${
        excedido
          ? "text-red-600 dark:text-red-400"
          : "text-emerald-600 dark:text-emerald-400"
      }`}
    >
      {excedido ? `−${formatCurrency(Math.abs(value))}` : formatCurrency(value)}
    </span>
  );
}

/** Cabecera con el total presupuestado del mes frente a lo gastado. */
function GoalsTotals({
  totals,
}: {
  totals: { meta: number; gastado: number; disponible: number; porcentaje: number };
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div>
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Total presupuestado
          </p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums">
            {formatCurrency(totals.meta)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Gastado
          </p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums">
            {formatCurrency(totals.gastado)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Disponible
          </p>
          <p className="mt-0.5 text-xl font-semibold">
            <Disponible value={totals.disponible} />
          </p>
        </div>
        <div>
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Avance
          </p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums">
            {formatPercent(totals.porcentaje)}
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ hasGoals, month }: { hasGoals: boolean; month: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {hasGoals
          ? "Ninguna meta coincide con los filtros."
          : `Aún no hay metas para ${formatMonthLabel(month)}.`}
      </p>
      {!hasGoals && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
          Crea una para fijar cuánto quieres gastar en una categoría y ver cuánto llevas.{" "}
          <Link href="/movimientos" className="underline hover:no-underline">
            Ver movimientos
          </Link>
        </p>
      )}
    </div>
  );
}

const headingClass =
  "px-3 py-3 text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400";

const cellClass = "px-3 py-3 text-zinc-600 dark:text-zinc-400";
