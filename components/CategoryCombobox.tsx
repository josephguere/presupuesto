"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CATEGORIES, NO_CATEGORY, NO_CATEGORY_LABEL } from "@/lib/categories";
import { deaccent } from "@/lib/parsers/normalize";

/**
 * Selector de categoría con búsqueda.
 *
 * Con veintiséis categorías, un `<select>` obliga a recorrer la lista entera con
 * la vista. Aquí se escriben tres letras y la lista se reduce.
 *
 * SIN DEPENDENCIAS NUEVAS. Un combobox accesible es un input, una lista y cinco
 * teclas; traerse una librería de autocompletado costaría más peso del que ocupa
 * todo este archivo. El comparador es `deaccent`, el mismo que usa el parser de
 * correos para reconocer «Débito» escrito sin tilde: escribir `cafe` encuentra
 * «Café y snacks».
 *
 * EL VALOR VIAJA EN UN INPUT OCULTO. Así el componente funciona igual dentro de
 * un formulario GET de servidor (la barra de filtros) que dentro de uno enviado
 * por Server Action (crear y editar), y si el JavaScript no llega a cargar el
 * formulario sigue enviando el valor que ya tenía.
 */

export interface CategoryOption {
  value: string;
  label: string;
}

/**
 * Coincidencias del texto escrito.
 *
 * `deaccent` —el mismo que usa el parser de correos— quita tildes y baja a
 * minúsculas, así que `cafe` encuentra «Café y snacks». Y se compara por
 * «contiene», no por «empieza por»: buscar `taxi` debe encontrar «Movilidad
 * Taxi», que es donde la mitad de la gente empezaría a escribir.
 *
 * Está fuera del componente para poder probarla sin renderizar nada.
 */
export function filterCategories(options: CategoryOption[], query: string): CategoryOption[] {
  const needle = deaccent(query.trim());
  if (needle === "") return options;

  return options.filter((option) => deaccent(option.label).includes(needle));
}

/** Opciones del formulario: el catálogo más «Sin categoría». */
export const FORM_CATEGORY_OPTIONS: CategoryOption[] = [
  { value: NO_CATEGORY, label: NO_CATEGORY_LABEL },
  ...CATEGORIES.map((category) => ({ value: category, label: category })),
];

export function CategoryCombobox({
  name,
  options,
  defaultValue,
  value,
  onChange,
  placeholder = "Escribe para buscar...",
  ariaLabel = "Categoría",
  id,
}: {
  /** Nombre del campo que se envía en el formulario. */
  name: string;
  options: CategoryOption[];
  defaultValue?: string;
  /**
   * Valor controlado desde fuera. Cuando se pasa, manda sobre la elección
   * interna.
   *
   * Existe para que el formulario pueda aplicar una sugerencia automática: sin
   * esto, mover la categoría desde el padre repintaría el Resumen y el Grupo
   * pero dejaría el combo —y el campo oculto que se envía— con el valor viejo.
   */
  value?: string;
  /** Se llama al elegir; lo usa el formulario para recalcular el Grupo. */
  onChange?: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
}) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const listId = `${inputId}-lista`;

  const initial = options.find((option) => option.value === defaultValue) ?? options[0];

  const [internal, setInternal] = useState<CategoryOption>(initial);

  // Controlado si llega `value`; si no, se gobierna solo. Que la opción se
  // busque en cada render es lo que hace que el padre pueda cambiarla.
  const controlled = options.find((option) => option.value === value);
  const selected = controlled ?? internal;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => filterCategories(options, query), [options, query]);

  // Cerrar al pulsar fuera. Sin esto el desplegable se queda abierto tapando el
  // resto del formulario.
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(event.target as Node)) close();
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [open]);

  // Mantener a la vista la opción resaltada al moverse con el teclado.
  useEffect(() => {
    if (!open) return;
    const item = listRef.current?.children[highlighted] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlighted, open]);

  function close() {
    setOpen(false);
    setQuery("");
    setHighlighted(0);
  }

  function choose(option: CategoryOption) {
    setInternal(option);
    onChange?.(option.value);
    close();
    inputRef.current?.blur();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (matches.length === 0) return;

      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted((current) => (current + step + matches.length) % matches.length);
      return;
    }

    if (event.key === "Enter") {
      // Solo se traga el Enter si hay algo que elegir; si no, deja enviar el
      // formulario como haría cualquier otro campo.
      if (open && matches[highlighted]) {
        event.preventDefault();
        choose(matches[highlighted]);
      }
      return;
    }

    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        close();
      }
      return;
    }

    if (event.key === "Tab" && open) close();
  }

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Lo que de verdad se envía. */}
      <input type="hidden" name={name} value={selected.value} readOnly />

      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-activedescendant={open && matches[highlighted] ? `${listId}-${highlighted}` : undefined}
        autoComplete="off"
        // Al abrirse se vacía para poder escribir; al cerrarse vuelve a mostrar
        // lo elegido, que es lo que el usuario necesita ver el resto del tiempo.
        value={open ? query : selected.label}
        placeholder={open ? placeholder : undefined}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlighted(0);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className={`${inputClass} cursor-pointer`}
      />

      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-3 bottom-2.5 text-xs text-zinc-400"
      >
        ▾
      </span>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-zinc-300 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-950"
        >
          {matches.length === 0 && (
            <li className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
              Sin coincidencias
            </li>
          )}

          {matches.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.value === selected.value}
              // `mousedown` y no `click`: el clic llega después del blur del
              // input, y para entonces la lista ya se habría cerrado.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(option);
              }}
              onMouseEnter={() => setHighlighted(index)}
              className={`cursor-pointer px-3 py-2 text-sm ${
                index === highlighted
                  ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-700 dark:text-zinc-300"
              } ${option.value === selected.value ? "font-medium" : ""}`}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const inputClass =
  "w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 " +
  "dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50";
