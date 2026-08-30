import { CATEGORIES, GROUPS, NO_CATEGORY_LABEL } from "@/lib/categories";
import { CategoryCombobox, type CategoryOption } from "./CategoryCombobox";
import { formatMonthLabel } from "@/lib/format";
import { UNCATEGORIZED_FILTER } from "@/lib/transactions";

/**
 * Filtros de período, categoría y grupo.
 *
 * Es un `<form method="get">` normal: el estado vive en la URL y el filtrado
 * ocurre en el servidor. Cero JavaScript de cliente, la vista es enlazable y
 * compartible, y funciona aunque falle la hidratación.
 *
 * Período tiene dos modos EXCLUYENTES, y se ve cuál está activo: si hay fechas
 * en el rango personalizado, manda el rango y el selector de mes se atenúa. Sin
 * esa señal, el usuario no sabría por qué el mes elegido no surte efecto.
 *
 * La única pieza con JavaScript es el buscador de categorías, que con veintiséis
 * opciones se agradece. Envía su valor en un input oculto, así que el formulario
 * sigue siendo un GET normal y el enlace resultante sigue siendo compartible.
 *
 * `[&>*]:min-w-0` en las rejillas no es adorno: los hijos de un grid tienen
 * `min-width: auto`, y un `<select>` mide lo que su opción más larga. Con
 * «Peajes y estacionamiento» dentro, dos columnas se plantan en unos 470 px y
 * desbordan cualquier móvil. Con `min-w-0` la columna puede encogerse.
 */
export function FiltersBar({
  action,
  months,
  values,
  mode,
}: {
  /** A qué ruta se envía el formulario. */
  action: string;
  months: string[];
  values: { month?: string; from?: string; to?: string; category?: string; group?: string };
  mode: "month" | "range";
}) {
  const isRange = mode === "range";
  const hasFilters = Boolean(
    values.month || values.from || values.to || values.category || values.group,
  );

  return (
    <form
      method="get"
      action={action}
      className="rounded-xl border border-zinc-200 bg-white p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
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

        <Field label="Categoría">
          <CategoryCombobox
            name="categoria"
            options={FILTER_CATEGORY_OPTIONS}
            defaultValue={values.category ?? ""}
            ariaLabel="Filtrar por categoría"
          />
        </Field>

        <Field label="Grupo">
          <select name="grupo" defaultValue={values.group ?? ""} className={inputClass}>
            <option value="">Todos</option>
            {GROUPS.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
        </Field>

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

/** Opciones del filtro: «Todas» primero, luego «Sin categoría» y el catálogo. */
const FILTER_CATEGORY_OPTIONS: CategoryOption[] = [
  { value: "", label: "Todas" },
  { value: UNCATEGORIZED_FILTER, label: NO_CATEGORY_LABEL },
  ...CATEGORIES.map((category) => ({ value: category, label: category })),
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
    <label className={`flex flex-col gap-1.5 ${dimmed ? "opacity-60" : ""}`}>
      <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        {label}
        {hint && <span className="ml-1 normal-case opacity-80">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}
