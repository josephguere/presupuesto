import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  GROUPS,
  NO_CATEGORY,
  getCategoriesInGroup,
  getGroupForCategory,
  isValidCategory,
  isValidGroup,
  toStoredCategory,
} from "./categories";

describe("catálogo de categorías", () => {
  it("no tiene duplicados", () => {
    expect(new Set(CATEGORIES).size).toBe(CATEGORIES.length);
  });

  it("contiene las 17 categorías acordadas", () => {
    expect(CATEGORIES).toEqual([
      "Ingresos",
      "Suscripciones",
      "Servicios",
      "Educación",
      "Supermercado",
      "Restaurantes",
      "Delivery",
      "Transporte",
      "Combustible",
      "Salud",
      "Farmacia",
      "Entretenimiento",
      "Hogar",
      "Ropa",
      "Tecnología",
      "Transferencias",
      "Otros",
    ]);
  });

  it("acepta solo valores del catálogo", () => {
    expect(isValidCategory("Supermercado")).toBe(true);
    expect(isValidCategory("supermercado")).toBe(false);
    expect(isValidCategory("Categoría Inventada")).toBe(false);
    expect(isValidCategory(null)).toBe(false);
    expect(isValidCategory(42)).toBe(false);
  });

  it("nunca devuelve texto libre del cliente", () => {
    expect(toStoredCategory("'; drop table transactions; --")).toBeNull();
    expect(toStoredCategory("<script>alert(1)</script>")).toBeNull();
    expect(toStoredCategory(NO_CATEGORY)).toBeNull();
    expect(toStoredCategory("")).toBeNull();
    expect(toStoredCategory("Otros")).toBe("Otros");
  });
});

describe("categoría → grupo", () => {
  // Los tres ejemplos del acuerdo.
  it.each([
    ["Suscripciones", "GASTOS FIJOS"],
    ["Restaurantes", "GASTOS VARIABLES"],
    ["Ingresos", "INGRESOS"],
  ])("%s pertenece a %s", (category, group) => {
    expect(getGroupForCategory(category)).toBe(group);
  });

  it.each([
    ["Servicios", "GASTOS FIJOS"],
    ["Educación", "GASTOS FIJOS"],
    ["Supermercado", "GASTOS VARIABLES"],
    ["Delivery", "GASTOS VARIABLES"],
    ["Transporte", "GASTOS VARIABLES"],
    ["Combustible", "GASTOS VARIABLES"],
    ["Salud", "GASTOS VARIABLES"],
    ["Farmacia", "GASTOS VARIABLES"],
    ["Entretenimiento", "GASTOS VARIABLES"],
    ["Hogar", "GASTOS VARIABLES"],
    ["Ropa", "GASTOS VARIABLES"],
    ["Tecnología", "GASTOS VARIABLES"],
    ["Transferencias", "GASTOS VARIABLES"],
    ["Otros", "GASTOS VARIABLES"],
  ])("%s pertenece a %s", (category, group) => {
    expect(getGroupForCategory(category)).toBe(group);
  });

  it("sin categoría no tiene grupo", () => {
    // Deliberado: un movimiento sin clasificar NO cuenta como gasto fijo ni
    // variable. Se muestra aparte en «Pendiente de categorizar».
    expect(getGroupForCategory(null)).toBeNull();
    expect(getGroupForCategory(undefined)).toBeNull();
    expect(getGroupForCategory("")).toBeNull();
  });

  it("una categoría desconocida tampoco tiene grupo", () => {
    // Por si quedara alguna en base de datos de una versión anterior.
    expect(getGroupForCategory("Cripto")).toBeNull();
  });

  it("toda categoría del catálogo tiene grupo", () => {
    for (const category of CATEGORIES) {
      expect(GROUPS).toContain(getGroupForCategory(category));
    }
  });
});

describe("grupo → categorías", () => {
  it("los grupos particionan el catálogo sin solaparse", () => {
    const fromGroups = GROUPS.flatMap((group) => getCategoriesInGroup(group));
    expect(new Set(fromGroups).size).toBe(fromGroups.length);
    expect(fromGroups.sort()).toEqual([...CATEGORIES].sort());
  });

  it("INGRESOS solo contiene Ingresos", () => {
    expect(getCategoriesInGroup("INGRESOS")).toEqual(["Ingresos"]);
  });

  it("GASTOS FIJOS son los tres acordados", () => {
    expect(getCategoriesInGroup("GASTOS FIJOS")).toEqual([
      "Suscripciones",
      "Servicios",
      "Educación",
    ]);
  });

  it("isValidGroup rechaza cualquier otra cosa", () => {
    expect(isValidGroup("INGRESOS")).toBe(true);
    expect(isValidGroup("ingresos")).toBe(false);
    expect(isValidGroup("GASTOS")).toBe(false);
    expect(isValidGroup(null)).toBe(false);
  });
});
