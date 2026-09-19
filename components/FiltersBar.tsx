"use client";

import { useState } from "react";
import {
  CATEGORIES,
  GROUPS,
  NO_CATEGORY_LABEL,
  SUMMARY_CATEGORIES,
  getCategoriesInSummary,
  getSummariesInGroup,
  isValidGroup,
  isValidSummaryCategory,
} from "@/lib/categories";
import { MultiSelectFilter, type MultiSelectOption } from "./MultiSelectFilter";
import { formatMonthLabel } from "@/lib/format";
import { UNCATEGORIZED_FILTER } from "@/lib/transactions";

/**
 * Filtros de período, clasificación y contabilización.
 *
 * SIGUE SIENDO UN `<form method="get">`. El estado vive en la URL y el filtrado
 * ocurre en el servidor: la vista es enlazable y compartible, y funciona aunque
 * falle la hidratación. Los combos de selección múltiple no cambian eso —por
 * debajo son casillas con el mismo `name`, ver `MultiSelectFilter`—; lo único
 * que aporta el JavaScript es el desplegable y la dependencia entre niveles.
 *
 * Pasó a ser Client Component solo por esa dependencia: al cambiar «Categoría
 * resumen» hay que recalcular qué categorías se ofrecen. Antes se conseguía
 * remontando el combo con una `key`, que bastaba para un valor único y no
 * alcanza para una lista.
 *
 * Período tiene dos modos EXCLUYENTES, y se ve cuál está activo: si hay fechas
 * en el rango personalizado, manda el rango y el selector de mes se atenúa. Sin
 * esa señal, el usuario no sabría por qué el mes elegido no surte efecto.
 *
 * `[&>*]:min-w-0` en las rejillas no es adorno: los hijos de un grid tienen
 * `min-width: auto`, y un control mide lo que su opción más larga. Con «Peajes y
 * estacionamiento» dentro, dos columnas se plantan en unos 470 px y desbordan
 * cualquier móvil. Con `min-w-0` la columna puede encogerse.
 */
export function FiltersBar({
  action,
  months,
  values,
  mode,
  sort,
  showAccounting = true,
}: {
  /** A qué ruta se envía el formulario. */
  action: string;
  months: string[];
  /** Orden actual, para que filtrar no lo pierda. */
  sort?: string;
  values: {
    month?: string;
    from?: string;
    to?: string;
    categories: string[];
    summaries: string[];
    groups: string[];
    accounting: string[];
  };
  mode: "month" | "range";
  /**
   * La papelera no lo muestra: allí se ven todas las bajas, cuenten o no.
   * Ver `resolveAccountingFilter`.
   */
  showAccounting?: boolean;
}) {
  const isRange = mode === "range";

  // Los dos niveles superiores son estado local porque el de abajo depende de
  // ellos. El resto de campos siguen siendo no controlados.
  const [groups, setGroups] = useState<string[]>(values.groups);
  const [summaries, setSummaries] = useState<string[]>(values.summaries);

  // Filtros coherentes entre sí: cada nivel solo ofrece lo que cabe dentro de
  // los de arriba. Sin esto se puede pedir «Alimentación» + «Luz», que no
  // devuelve nada y se lee como un fallo en vez de como una combinación
  // imposible.
  const summaryOptions = summaryOptionsFor(groups);
  const categoryOptions = categoryOptionsFor(summaries, groups);

  const hasFilters = Boolean(
    values.month ||
      values.from ||
      values.to ||
      values.categories.length > 0 ||
      values.summaries.length > 0 ||
      values.groups.length > 0 ||
      values.accounting.length > 0,
  );

  return (
    <form
      method="get"
      action={action}
      className="rounded-xl border border-zinc-200 bg-white p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {/* El orden viaja escondido en el formulario. Sin esto, filtrar volvería
          a «Más recientes» sin que el usuario lo haya pedido. «Limpiar» es un
          enlace a la ruta pelada, así que ahí sí desaparece, que es lo acordado. */}
      {sort && <input type="hidden" name="orden" value={sort} />}

      <div
        className={`grid grid-cols-2 gap-3 [&>*]:min-w-0 ${
          showAccounting ? "lg:grid-cols-6" : "lg:grid-cols-5"
        }`}
      >
        <Field label="Mes" hint={isRange ? "ignorado: hay un rango" : undefined} dimmed={isRange}>
          <select name="mes" defaultValue={values.month ?? ""} className={inputClass}>
            {/* Vacío = «todos». Al entrar sin filtros la página preselecciona el
                mes en curso, así que llegar aquí con esta opción marcada
                significa que la eligió el usuario. */}
            <option value="">Todos los meses</option>
            {months.map((month) => (
              <option key={month} value={month}>
                {formatMonthLabel(month)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Grupo">
          <MultiSelectFilter
            name="grupo"
            label="grupos"
            options={GROUP_OPTIONS}
            selected={values.groups}
            onChange={setGroups}
          />
        </Field>

        <Field label="Categoría resumen" hint={groups.length > 0 ? "dentro del grupo" : undefined}>
          <MultiSelectFilter
            name="categoriaResumen"
            label="resúmenes"
            options={summaryOptions}
            selected={values.summaries}
            onChange={setSummaries}
            searchable
          />
        </Field>

        <Field
          label="Categoría"
          hint={summaries.length > 0 ? "dentro del resumen" : undefined}
        >
          <MultiSelectFilter
            name="categoria"
            label="categorías"
            options={categoryOptions}
            selected={values.categories}
            searchable
          />
        </Field>

        {showAccounting && (
          <Field label="Contabilización">
            <MultiSelectFilter
              name="contab"
              label="estados"
              options={ACCOUNTING_OPTIONS}
              // Sin parámetro, lo que se está viendo son los contabilizados.
              // El combo tiene que reflejarlo o mentiría sobre el filtro activo.
              selected={values.accounting.length > 0 ? values.accounting : ["contabilizados"]}
              allLabel="Contabilizados"
              requireOne
            />
          </Field>
        )}

        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Filtrar
          </button>
          {hasFilters && (
            <a
              href={action}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Limpiar
            </a>
          )}
        </div>
      </div>

      <fieldset className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <legend className="sr-only">Rango personalizado</legend>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
          <Field
            label="Desde"
            hint={isRange ? "rango activo" : "opcional: sustituye al mes"}
            dimmed={!isRange}
          >
            <input type="date" name="desde" defaultValue={values.from ?? ""} className={inputClass} />
          </Field>

          <Field label="Hasta" dimmed={!isRange}>
            <input type="date" name="hasta" defaultValue={values.to ?? ""} className={inputClass} />
          </Field>
        </div>
      </fieldset>
    </form>
  );
}

/**
 * Opciones del filtro de categoría, dependientes de los niveles superiores.
 *
 * Se estrecha de arriba abajo: primero los grupos elegidos, luego los resúmenes.
 * Devuelve el catálogo entero cuando no hay nada arriba.
 *
 * Está fuera del componente para poder probarla sin renderizar el formulario.
 */
export function categoryOptionsFor(
  summaries: string[],
  groups: string[] = [],
): MultiSelectOption[] {
  const validSummaries = summaries.filter(isValidSummaryCategory);

  // Sin resúmenes, mandan los grupos; sin ninguno de los dos, todo el catálogo.
  const effective =
    validSummaries.length > 0
      ? validSummaries
      : groups.filter(isValidGroup).flatMap((group) => getSummariesInGroup(group));

  if (effective.length === 0) return ALL_CATEGORY_OPTIONS;

  const categories = [
    ...new Set(effective.flatMap((summary) => getCategoriesInSummary(summary))),
  ];

  return categories.map((category) => ({ value: category, label: category }));
}

/** Opciones del filtro de categoría resumen, dentro de los grupos elegidos. */
export function summaryOptionsFor(groups: string[]): MultiSelectOption[] {
  if (groups.length === 0) return ALL_SUMMARY_OPTIONS;

  const summaries = [
    ...new Set(groups.filter(isValidGroup).flatMap((group) => getSummariesInGroup(group))),
  ];

  return summaries.map((summary) => ({ value: summary, label: summary }));
}

const ALL_SUMMARY_OPTIONS: MultiSelectOption[] = SUMMARY_CATEGORIES.map((summary) => ({
  value: summary,
  label: summary,
}));

/** «Sin categoría» va primero: es lo que más se busca al repasar el mes. */
const ALL_CATEGORY_OPTIONS: MultiSelectOption[] = [
  { value: UNCATEGORIZED_FILTER, label: NO_CATEGORY_LABEL },
  ...CATEGORIES.map((category) => ({ value: category, label: category })),
];

const GROUP_OPTIONS: MultiSelectOption[] = GROUPS.map((group) => ({
  value: group,
  label: group,
}));

/**
 * Los dos estados de contabilización.
 *
 * No hay opción «Todos» porque marcar las dos ya lo significa, y tener las tres
 * permitiría estados que dicen lo mismo de dos formas distintas.
 */
const ACCOUNTING_OPTIONS: MultiSelectOption[] = [
  { value: "contabilizados", label: "Contabilizados" },
  { value: "no-contabilizados", label: "No contabilizados" },
];

const inputClass =
  "w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 " +
  "dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50";

function Field({
  label,
  hint,
  dimmed,
  children,
}: {
  label: string;
  hint?: string;
  dimmed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${dimmed ? "opacity-60" : ""}`}>
      <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        {label}
        {hint && <span className="ml-1 normal-case opacity-80">· {hint}</span>}
      </span>
      {children}
    </div>
  );
}
