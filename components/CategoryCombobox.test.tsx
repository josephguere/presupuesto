import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CategoryCombobox,
  FORM_CATEGORY_OPTIONS,
  filterCategories,
  type CategoryOption,
} from "./CategoryCombobox";
import { CATEGORIES, NO_CATEGORY } from "@/lib/categories";

/**
 * El buscador de categorías.
 *
 * La búsqueda se prueba sobre `filterCategories`, que es la función pura que usa
 * el componente en cada tecla: es exactamente lo que ve el usuario mientras
 * escribe, sin montar un DOM para comprobarlo.
 */

/** Etiquetas que devuelve la búsqueda, para leer las expectativas de un vistazo. */
function buscar(query: string): string[] {
  return filterCategories(FORM_CATEGORY_OPTIONS, query).map((option) => option.label);
}

describe("búsqueda de categorías", () => {
  it("los ejemplos acordados", () => {
    expect(buscar("seg")).toContain("Seguros");
    expect(buscar("pea")).toContain("Peajes y estacionamiento");
    expect(buscar("cafe")).toContain("Café y snacks");
  });

  it("encuentra sin escribir las tildes", () => {
    // Lo importante de verdad: nadie escribe «Café» con tilde en un buscador.
    expect(buscar("cafe")).toEqual(["Café y snacks"]);
    expect(buscar("educacion")).toEqual(["Educación"]);
    expect(buscar("tecnologia")).toEqual(["Tecnología"]);
    expect(buscar("vehiculo")).toEqual(["Mantenimiento Vehículo"]);
  });

  it("también encuentra si SÍ las escribe", () => {
    expect(buscar("café")).toEqual(["Café y snacks"]);
    expect(buscar("Educación")).toEqual(["Educación"]);
  });

  it("ignora mayúsculas y espacios de sobra", () => {
    for (const query of ["SEGUROS", "Seguros", "  seguros  ", "sEgUrOs"]) {
      expect(buscar(query)).toEqual(["Seguros"]);
    }
  });

  it("busca dentro del nombre, no solo al principio", () => {
    // Quien busca un taxi escribe «taxi», no «movilidad».
    expect(buscar("taxi")).toEqual(["Movilidad Taxi"]);
    expect(buscar("snacks")).toEqual(["Café y snacks"]);
    expect(buscar("online")).toEqual(["Compras online"]);
    expect(buscar("personal")).toEqual(["Cuidado personal"]);
  });

  it("una búsqueda vacía no filtra nada", () => {
    expect(filterCategories(FORM_CATEGORY_OPTIONS, "")).toHaveLength(
      FORM_CATEGORY_OPTIONS.length,
    );
    expect(filterCategories(FORM_CATEGORY_OPTIONS, "   ")).toHaveLength(
      FORM_CATEGORY_OPTIONS.length,
    );
  });

  it("sin coincidencias devuelve una lista vacía, no todo", () => {
    // Devolver el catálogo entero sería peor que no encontrar nada: el usuario
    // creería que su búsqueda acertó.
    expect(buscar("zzzz")).toEqual([]);
    expect(buscar("criptomonedas")).toEqual([]);
  });

  it("varias coincidencias se muestran todas", () => {
    const resultado = buscar("a");
    expect(resultado.length).toBeGreaterThan(1);
    expect(resultado).toContain("Farmacia");
  });

  it("todas las categorías del catálogo son alcanzables", () => {
    // Si una no se encontrara escribiendo su propio nombre, sería inalcanzable
    // desde el formulario.
    for (const category of CATEGORIES) {
      expect(buscar(category)).toContain(category);
    }
  });
});

describe("marcado del combobox", () => {
  function render(props: Partial<Parameters<typeof CategoryCombobox>[0]> = {}): string {
    return renderToStaticMarkup(
      <CategoryCombobox name="category" options={FORM_CATEGORY_OPTIONS} {...props} />,
    );
  }

  it("el valor viaja en un campo oculto con el nombre del formulario", () => {
    const html = render({ defaultValue: "Seguros" });

    expect(html).toContain('type="hidden"');
    expect(html).toContain('name="category"');
    expect(html).toContain('value="Seguros"');
  });

  it("es un combobox accesible", () => {
    const html = render();

    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain("aria-controls=");
  });

  it("muestra la categoría elegida, no un hueco", () => {
    expect(render({ defaultValue: "Peajes y estacionamiento" })).toContain(
      "Peajes y estacionamiento",
    );
  });

  it("sin valor arranca en la primera opción", () => {
    const html = render();
    expect(html).toContain(`value="${NO_CATEGORY}"`);
  });

  it("un valor desconocido no lo deja en blanco", () => {
    // Podría llegar de una URL manipulada o de una categoría retirada.
    const html = render({ defaultValue: "Categoría Que No Existe" });
    expect(html).toContain(`value="${NO_CATEGORY}"`);
  });

  it("sirve igual para el filtro, con su propio catálogo", () => {
    const filtro: CategoryOption[] = [
      { value: "", label: "Todas" },
      { value: "Otros", label: "Otros" },
    ];

    const html = renderToStaticMarkup(
      <CategoryCombobox name="categoria" options={filtro} defaultValue="" />,
    );

    expect(html).toContain('name="categoria"');
    expect(html).toContain("Todas");
  });
});
