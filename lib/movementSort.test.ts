import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOVEMENT_SORT,
  MOVEMENT_SORTS,
  MOVEMENT_SORT_LABELS,
  amountSortArrow,
  amountSortLabel,
  nextAmountSort,
  parseMovementSort,
} from "./movementSort";
import { parseFilters } from "./transactions";

/**
 * El orden de la lista de movimientos.
 *
 * La cabecera de escritorio y el selector de móvil son dos formas de escribir el
 * mismo parámetro de la URL, así que probar aquí cubre las dos.
 */

describe("orden por defecto", () => {
  it("es «más recientes»", () => {
    expect(DEFAULT_MOVEMENT_SORT).toBe("recientes");
    expect(parseMovementSort(undefined)).toBe("recientes");
  });

  it("sin orden por monto no hay flecha", () => {
    expect(amountSortArrow("recientes")).toBe("");
    expect(amountSortArrow("antiguos")).toBe("");
  });

  it("una URL manipulada cae en el orden de siempre", () => {
    for (const value of ["", "monto", "amount-desc", "'; drop table", ["x", "y"]]) {
      expect(parseMovementSort(value)).toBe("recientes");
    }
  });

  it("se queda con el primer valor si el parámetro se repite", () => {
    expect(parseMovementSort(["monto-asc", "monto-desc"])).toBe("monto-asc");
  });
});

describe("alternar desde la cabecera «Monto»", () => {
  it("el primer clic ordena de mayor a menor", () => {
    // Al buscar en qué se fue el dinero, lo primero que se quiere ver es lo caro.
    expect(nextAmountSort("recientes")).toBe("monto-desc");
    expect(nextAmountSort("antiguos")).toBe("monto-desc");
  });

  it("el segundo clic ordena de menor a mayor", () => {
    expect(nextAmountSort("monto-desc")).toBe("monto-asc");
  });

  it("los siguientes alternan", () => {
    expect(nextAmountSort("monto-asc")).toBe("monto-desc");
    expect(nextAmountSort(nextAmountSort("monto-desc"))).toBe("monto-desc");
  });

  it("la flecha corresponde al orden aplicado", () => {
    expect(amountSortArrow("monto-desc")).toBe("↓");
    expect(amountSortArrow("monto-asc")).toBe("↑");
  });

  it("la etiqueta accesible dice qué hará el clic, no qué se ve", () => {
    expect(amountSortLabel("recientes")).toBe("Ordenar monto de mayor a menor");
    expect(amountSortLabel("monto-desc")).toBe("Ordenar monto de menor a mayor");
    expect(amountSortLabel("monto-asc")).toBe("Ordenar monto de mayor a menor");
  });
});

describe("equivalencia entre escritorio y móvil", () => {
  it("las cuatro opciones del selector tienen etiqueta", () => {
    for (const sort of MOVEMENT_SORTS) {
      expect(MOVEMENT_SORT_LABELS[sort]).toBeTruthy();
    }
  });

  it("«Mayor monto» es la flecha hacia abajo y «Menor monto» la de arriba", () => {
    expect(MOVEMENT_SORT_LABELS["monto-desc"]).toBe("Mayor monto");
    expect(MOVEMENT_SORT_LABELS["monto-asc"]).toBe("Menor monto");
    expect(amountSortArrow("monto-desc")).toBe("↓");
    expect(amountSortArrow("monto-asc")).toBe("↑");
  });
});

describe("el orden convive con los filtros", () => {
  it("se lee de la URL junto a ellos", () => {
    const parsed = parseFilters({
      mes: "2026-08",
      categoriaResumen: "Alimentación",
      orden: "monto-desc",
    });

    expect(parsed.sort).toBe("monto-desc");
    expect(parsed.filters.month).toBe("2026-08");
    expect(parsed.filters.summary).toBe("Alimentación");
  });

  it("sin parámetro `orden`, los filtros no se ven afectados", () => {
    const parsed = parseFilters({ categoria: "Delivery" });

    expect(parsed.sort).toBe("recientes");
    // El orden por defecto no se guarda como filtro: la consulta ya lo aplica.
    expect(parsed.filters.sort).toBeUndefined();
  });

  it("«Limpiar» quita el orden porque quita todos los parámetros", () => {
    // El botón es un enlace a la ruta pelada, así que esto es lo que queda.
    const parsed = parseFilters({});

    expect(parsed.sort).toBe("recientes");
    expect(parsed.filters).toEqual({});
  });
});
