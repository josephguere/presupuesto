"use client";

import { useState } from "react";
import { GROUPS } from "@/lib/categories";
import { MultiSelectFilter, type MultiSelectOption } from "./MultiSelectFilter";
import { categoryOptionsFor, summaryOptionsFor } from "./FiltersBar";
import { formatMonthLabel } from "@/lib/format";

/**
 * Filtros de la pantalla de Metas.
 *
 * Reutiliza los MISMOS combos de selección múltiple y las MISMAS funciones de
 * dependencia entre niveles que `FiltersBar` —`summaryOptionsFor` y
 * `categoryOptionsFor` se importan de allí, no se reescriben—, así que
 * «Entretenimiento» ofrece las mismas categorías en las tres pantallas.
 *
 * Es un componente aparte y no un parámetro de `FiltersBar` por dos diferencias
 * que no son cosméticas:
 *
 *   · NO hay «Todos los meses». Una meta es de un mes concreto; sin mes no hay
 *     nada con lo que comparar el gasto.
 *   · NO hay rango de fechas ni contabilización. El rango no tiene sentido sobre
 *     metas mensuales, y la contabilización ya está decidida: las metas siempre
 *     cuentan solo los movimientos que cuentan.
 *
 * Meterlo todo en `FiltersBar` con tres banderas habría dejado un componente que
 * se lee peor que los dos por separado.
 */
export function GoalsFilterBar({
  months,
  values,
}: {
  months: string[];
  values: {
    month: string;
    categories: string[];
    summaries: string[];
    groups: string[];
  };
}) {
  const [groups, setGroups] = useState<string[]>(values.groups);
  const [summaries, setSummaries] = useState<string[]>(values.summaries);

  const hasFilters =
    values.categories.length > 0 || values.summaries.length > 0 || values.groups.length > 0;

  return (
    <form
      method="get"
      action="/metas"
      className="rounded-xl border border-zinc-200 bg-white p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 [&>*]:min-w-0">
        <Field label="Mes">
          <select name="mes" defaultValue={values.month} className={inputClass}>
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

        <Field label="Categoría resumen">
          <MultiSelectFilter
            name="categoriaResumen"
            label="resúmenes"
            options={summaryOptionsFor(groups)}
            selected={values.summaries}
            onChange={setSummaries}
            searchable
          />
        </Field>

        <Field label="Categoría">
          <MultiSelectFilter
            name="categoria"
            label="categorías"
            // Sin «Sin categoría»: una meta siempre es de una categoría
            // concreta, así que esa opción no tendría a qué aplicarse.
            options={categoryOptionsFor(summaries, groups).filter(
              (option) => !option.value.startsWith("__"),
            )}
            selected={values.categories}
            searchable
          />
        </Field>

        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Filtrar
          </button>
          {hasFilters && (
            // Conserva el mes: limpiar los filtros de clasificación no debería
            // devolverte a otro mes del que estabas mirando.
            <a
              href={`/metas?mes=${values.month}`}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Limpiar
            </a>
          )}
        </div>
      </div>
    </form>
  );
}

const GROUP_OPTIONS: MultiSelectOption[] = GROUPS.map((group) => ({
  value: group,
  label: group,
}));

const inputClass =
  "w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 " +
  "dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        {label}
      </span>
      {children}
    </div>
  );
}
