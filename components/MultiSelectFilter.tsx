"use client";

import { useEffect, useId, useRef, useState } from "react";
import { deaccent } from "@/lib/parsers/normalize";

/**
 * Filtro de selección múltiple con casillas.
 *
 * LO QUE SE ENVÍA SON CASILLAS DE VERDAD. El desplegable es apariencia; por
 * debajo hay un `<input type="checkbox">` por opción, todos con el mismo `name`.
 * Un formulario GET los manda como parámetros repetidos
 * —`?categoria=Delivery&categoria=Luz`— y el servidor los lee tal cual.
 *
 * Eso es lo que permite convertir los filtros en multiselección SIN romper lo
 * que ya funcionaba: la barra sigue siendo un `<form method="get">`, el estado
 * sigue viviendo en la URL, la vista sigue siendo enlazable y compartible, y el
 * filtrado sigue ocurriendo en el servidor. Un componente con estado propio que
 * enviara JSON habría obligado a reescribir las tres pantallas.
 *
 * Y sigue funcionando sin JavaScript: si la hidratación falla, las casillas
 * quedan visibles dentro del panel y el formulario se envía igual.
 *
 * SIN DEPENDENCIAS NUEVAS. Es el mismo patrón de `CategoryCombobox` —contenedor
 * con `ref`, cierre al pulsar fuera, Escape— porque traerse una librería de
 * popovers costaría más peso que todo este archivo.
 *
 * UN SOLO COMPONENTE para categoría, categoría resumen, grupo y contabilización.
 * Las opciones llegan por props; no hay un `CategoryMultiSelect` y un
 * `GroupMultiSelect` casi idénticos que un día se separen.
 */

export interface MultiSelectOption {
  value: string;
  label: string;
}

export function MultiSelectFilter({
  name,
  options,
  selected,
  label,
  allLabel = "Todas",
  searchable = false,
  requireOne = false,
  onChange,
}: {
  /** Nombre del parámetro. Se repite en cada casilla marcada. */
  name: string;
  options: MultiSelectOption[];
  /** Valores marcados al cargar, tal como vinieron de la URL. */
  selected: string[];
  /** Texto del botón cuando no hay nada marcado. */
  label: string;
  allLabel?: string;
  /** Añade un buscador. Solo tiene sentido con muchas opciones. */
  searchable?: boolean;
  /**
   * Impide dejar cero opciones marcadas.
   *
   * Lo usa Contabilización: sin ninguna marcada, el filtro no significa nada y
   * el servidor tendría que adivinar. Con esto, el estado ambiguo no se puede
   * ni producir desde la interfaz.
   */
  requireOne?: boolean;
  /** Avisa al padre del cambio; lo usan los filtros dependientes. */
  onChange?: (values: string[]) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Las opciones válidas pueden cambiar (Categoría depende de Resumen), así que
  // lo marcado se poda contra ellas en cada render. Es lo que hace que al
  // cambiar el resumen solo se pierda la categoría que ya no cabe.
  const valid = new Set(options.map((option) => option.value));
  const [chosen, setChosen] = useState<string[]>(() =>
    selected.filter((value) => valid.has(value)),
  );
  const current = chosen.filter((value) => valid.has(value));

  const containerRef = useRef<HTMLDivElement>(null);

  // Cerrar al pulsar fuera. Sin esto el panel tapa el resto del formulario.
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [open]);

  function toggle(value: string) {
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];

    // La última casilla no se puede quitar si el filtro exige al menos una.
    if (requireOne && next.length === 0) return;

    setChosen(next);
    onChange?.(next);
  }

  function clear() {
    if (requireOne) return;
    setChosen([]);
    onChange?.([]);
  }

  const visible = searchable ? filterOptions(options, query) : options;

  return (
    <div ref={containerRef} className="relative w-full">
      {/*
        Lo que de verdad se envía: un campo oculto por opción marcada, todos con
        el mismo `name`. Van FUERA del panel para que sigan existiendo en el DOM
        cuando el desplegable está cerrado; dentro, cerrar el panel los
        desmontaría y el formulario se enviaría sin filtros.

        Sin nada marcado no se envía nada, y eso significa «sin filtro». No hace
        falta un centinela que distinga «vacío» de «ausente» porque los dos
        quieren decir lo mismo en los tres niveles, y en Contabilización
        `requireOne` impide que el vacío llegue a producirse.
      */}
      {current.map((value) => (
        <input key={value} type="hidden" name={name} value={value} />
      ))}

      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        className={`${controlClass} flex items-center justify-between gap-2 text-left`}
      >
        <span className="truncate">{summarize(current, options, label, allLabel)}</span>
        <span aria-hidden="true" className="shrink-0 text-xs text-zinc-400">
          ▾
        </span>
      </button>

      {open && (
        <div
          id={`${id}-panel`}
          role="group"
          aria-label={label}
          // `max-h` + scroll propio: con veintitantas categorías, en un móvil el
          // panel se saldría de la pantalla y arrastraría la página al hacer
          // scroll. `overscroll-contain` corta ese encadenamiento.
          className="absolute z-50 mt-1 flex max-h-72 w-full min-w-56 flex-col overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-950"
        >
          {searchable && (
            <div className="border-b border-zinc-200 p-2 dark:border-zinc-800">
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar..."
                aria-label={`Buscar en ${label}`}
                className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
          )}

          <ul className="overflow-y-auto overscroll-contain py-1">
            {visible.length === 0 && (
              <li className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
                Sin coincidencias
              </li>
            )}

            {visible.map((option) => {
              const checked = current.includes(option.value);
              // La única marcada, en un filtro que exige al menos una: se deja
              // ver marcada pero no se puede desmarcar.
              const locked = requireOne && checked && current.length === 1;

              return (
                <li key={option.value}>
                  <label
                    className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
                      locked ? "opacity-70" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={locked}
                      onChange={() => toggle(option.value)}
                      className="size-4 shrink-0 rounded border-zinc-300 dark:border-zinc-600"
                    />
                    <span className="truncate">{option.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>

          {!requireOne && current.length > 0 && (
            <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
              <button
                type="button"
                onClick={clear}
                className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                Quitar selección
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Qué pone en el botón.
 *
 * Con una sola opción se escribe su nombre; con varias, la cuenta. Listar tres
 * nombres largos no cabe en la columna y acabaría recortado a la mitad de una
 * palabra, que se lee peor que «3 seleccionadas».
 *
 * Está fuera del componente para poder probarlo sin renderizar nada.
 */
export function summarize(
  selected: string[],
  options: MultiSelectOption[],
  label: string,
  allLabel: string,
): string {
  if (selected.length === 0) return allLabel;

  if (selected.length === 1) {
    const found = options.find((option) => option.value === selected[0]);
    return found?.label ?? selected[0];
  }

  return `${selected.length} ${label.toLowerCase()}`;
}

/**
 * Coincidencias del buscador.
 *
 * Mismo criterio que `CategoryCombobox`: sin tildes y por «contiene», así que
 * `cafe` encuentra «Café y snacks» y `taxi` encuentra «Movilidad Taxi».
 */
export function filterOptions(
  options: MultiSelectOption[],
  query: string,
): MultiSelectOption[] {
  const needle = deaccent(query.trim());
  if (needle === "") return options;

  return options.filter((option) => deaccent(option.label).includes(needle));
}

const controlClass =
  "w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 " +
  "dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50";
