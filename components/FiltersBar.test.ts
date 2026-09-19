import { describe, expect, it } from "vitest";
import { categoryOptionsFor, summaryOptionsFor } from "./FiltersBar";
import { CATEGORIES, SUMMARY_CATEGORIES } from "@/lib/categories";

/**
 * Coherencia entre los filtros de grupo, categoría resumen y categoría.
 *
 * Se prueban las funciones puras que deciden las opciones: es lo que el usuario
 * ve al desplegar, sin tener que montar el formulario ni simular la apertura.
 *
 * Desde que los filtros admiten varias opciones, cada nivel se estrecha con
 * TODOS los de arriba, y lo elegido arriba puede ser más de una cosa. Es lo que
 * evita el estado incompatible —«Alimentación» + «Luz»— que no devuelve nada y
 * se lee como un fallo en vez de como una combinación imposible.
 */

/** Solo las etiquetas, para leer las expectativas de un vistazo. */
function categorias(summaries: string[], groups: string[] = []): string[] {
  return categoryOptionsFor(summaries, groups).map((option) => option.label);
}

function resumenes(groups: string[]): string[] {
  return summaryOptionsFor(groups).map((option) => option.label);
}

describe("filtro de categoría dependiente del resumen", () => {
  it("sin resumen ofrece el catálogo entero", () => {
    const todas = categorias([]);

    expect(todas).toContain("Sin categoría");
    for (const category of CATEGORIES) expect(todas).toContain(category);
  });

  it("con «Alimentación» solo ofrece las suyas", () => {
    expect(categorias(["Alimentación"])).toEqual([
      "Supermercado",
      "Restaurantes",
      "Delivery",
      "Café y snacks",
    ]);
  });

  it("con «Servicios del hogar» incluye la categoría nueva", () => {
    expect(categorias(["Servicios del hogar"])).toEqual([
      "Servicios",
      "Luz",
      "Gas Cálidda",
      "Internet",
      "Mantenimiento",
    ]);
  });

  it("con VARIOS resúmenes ofrece la unión de los dos", () => {
    // El caso del acuerdo: Entretenimiento + Servicios del hogar.
    const opciones = categorias(["Entretenimiento", "Servicios del hogar"]);

    expect(opciones).toEqual([
      "Entretenimiento",
      "Videojuegos",
      "Actividades infantiles",
      "Servicios",
      "Luz",
      "Gas Cálidda",
      "Internet",
      "Mantenimiento",
    ]);
  });

  it("nunca ofrece una categoría de otra familia", () => {
    const alimentacion = categorias(["Alimentación"]);

    expect(alimentacion).not.toContain("Luz");
    expect(alimentacion).not.toContain("Transporte");
    expect(alimentacion).not.toContain("Seguros");
  });

  it("un resumen inventado no reduce nada", () => {
    // Una URL manipulada debe dejar el filtro utilizable, no vaciarlo.
    expect(categorias(["Comida"])).toEqual(categorias([]));
    expect(categorias([""])).toEqual(categorias([]));
  });
});

describe("filtro de categoría dependiente del grupo", () => {
  it("sin resumen elegido, manda el grupo", () => {
    const fijos = categorias([], ["GASTOS FIJOS"]);

    expect(fijos).toContain("Luz");
    expect(fijos).toContain("Internet");
    expect(fijos).toContain("Pago Lley");
    expect(fijos).not.toContain("Delivery");
  });

  it("el resumen tiene prioridad sobre el grupo", () => {
    // Si el usuario bajó hasta el resumen, es lo más específico que ha dicho.
    expect(categorias(["Alimentación"], ["GASTOS FIJOS"])).toEqual(
      categorias(["Alimentación"]),
    );
  });
});

describe("filtro de categoría resumen dependiente del grupo", () => {
  it("sin grupo ofrece todos los resúmenes", () => {
    expect(resumenes([])).toEqual([...SUMMARY_CATEGORIES]);
  });

  it("con un grupo solo ofrece los suyos", () => {
    const fijos = resumenes(["GASTOS FIJOS"]);

    expect(fijos).toContain("Servicios del hogar");
    expect(fijos).toContain("Remesa");
    expect(fijos).not.toContain("Alimentación");
  });

  it("con dos grupos ofrece la unión", () => {
    const ambos = resumenes(["GASTOS FIJOS", "GASTOS VARIABLES"]);

    expect(ambos).toContain("Servicios del hogar");
    expect(ambos).toContain("Alimentación");
    expect(ambos).not.toContain("Ingresos");
  });
});
