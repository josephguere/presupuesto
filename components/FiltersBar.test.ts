import { describe, expect, it } from "vitest";
import { categoryOptionsFor } from "./FiltersBar";
import { CATEGORIES } from "@/lib/categories";

/**
 * Coherencia entre los filtros de categoría resumen y categoría.
 *
 * Se prueba la función pura que decide las opciones: es lo que el usuario ve al
 * desplegar, sin tener que montar el formulario ni simular la apertura.
 */

/** Solo las etiquetas, para leer las expectativas de un vistazo. */
function opciones(summary: string | null): string[] {
  return categoryOptionsFor(summary).map((option) => option.label);
}

describe("filtro de categoría dependiente del resumen", () => {
  it("sin resumen ofrece el catálogo entero", () => {
    const todas = opciones(null);

    expect(todas).toContain("Todas");
    expect(todas).toContain("Sin categoría");
    for (const category of CATEGORIES) expect(todas).toContain(category);
  });

  it("con «Alimentación» solo ofrece las suyas", () => {
    expect(opciones("Alimentación")).toEqual([
      "Todas",
      "Supermercado",
      "Restaurantes",
      "Delivery",
      "Café y snacks",
    ]);
  });

  it("con «Servicios del hogar» ofrece las cuatro del acuerdo", () => {
    expect(opciones("Servicios del hogar")).toEqual([
      "Todas",
      "Servicios",
      "Luz",
      "Gas Cálidda",
      "Mantenimiento",
    ]);
  });

  it("nunca ofrece una categoría de otra familia", () => {
    // Es lo que evita el estado incompatible: pedir «Alimentación» + «Luz».
    const alimentacion = opciones("Alimentación");

    expect(alimentacion).not.toContain("Luz");
    expect(alimentacion).not.toContain("Transporte");
    expect(alimentacion).not.toContain("Seguros");
  });

  it("siempre deja volver a «Todas»", () => {
    // Sin esa salida, elegido un resumen no habría forma de quitar la categoría.
    for (const summary of ["Alimentación", "Movilidad", "Vehículo", null]) {
      expect(opciones(summary)[0]).toBe("Todas");
    }
  });

  it("un resumen inventado no reduce nada", () => {
    // Una URL manipulada debe dejar el filtro utilizable, no vaciarlo.
    expect(opciones("Comida")).toEqual(opciones(null));
    expect(opciones("")).toEqual(opciones(null));
  });
});
