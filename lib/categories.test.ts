import { describe, expect, it } from "vitest";
import { CATEGORIES, NO_CATEGORY, isValidCategory, toStoredCategory } from "./categories";

describe("categorias", () => {
  it("no tiene duplicados", () => {
    expect(new Set(CATEGORIES).size).toBe(CATEGORIES.length);
  });

  it("acepta solo valores de la lista", () => {
    expect(isValidCategory("Supermercado")).toBe(true);
    expect(isValidCategory("supermercado")).toBe(false);
    expect(isValidCategory("Categoria Inventada")).toBe(false);
    expect(isValidCategory("")).toBe(false);
    expect(isValidCategory(null)).toBe(false);
    expect(isValidCategory(42)).toBe(false);
  });

  it("traduce el centinela a null", () => {
    expect(toStoredCategory(NO_CATEGORY)).toBeNull();
    expect(toStoredCategory("")).toBeNull();
  });

  it("nunca devuelve texto libre del cliente", () => {
    // Lo peor que puede llegar de un <select> manipulado.
    expect(toStoredCategory("'; drop table transactions; --")).toBeNull();
    expect(toStoredCategory("<script>alert(1)</script>")).toBeNull();
    expect(toStoredCategory("Otros")).toBe("Otros");
  });
});
