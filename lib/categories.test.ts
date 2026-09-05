import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  GROUPS,
  SUMMARY_CATEGORIES,
  getCategoriesInSummary,
  getGroupForSummary,
  getSummaryForCategory,
  isValidSummaryCategory,
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

  it("contiene las 29 categorías acordadas", () => {
    expect(CATEGORIES).toEqual([
      "Ingresos",

      "Suscripciones",

      "Servicios",
      "Luz",
      "Gas Cálidda",
      "Mantenimiento",

      "Educación",

      "Seguros",
      "Impuestos y tributos",

      "Supermercado",
      "Restaurantes",
      "Delivery",
      "Café y snacks",

      "Transporte",
      "Movilidad Taxi",
      "Peajes y estacionamiento",

      "Combustible",
      "Mantenimiento Vehículo",

      "Salud",
      "Farmacia",
      "Cuidado personal",

      "Entretenimiento",
      "Hogar",
      "Ropa",

      "Tecnología",
      "Compras online",

      "Regalos",
      "Transferencias",
      "Otros",
    ]);
  });

  it("conserva las 17 categorías originales", () => {
    // Lo que garantiza que ningún movimiento histórico se quede huérfano: si una
    // de estas desapareciera del catálogo, sus movimientos perderían el grupo y
    // caerían en «Pendiente de categorizar» sin que nadie los hubiera tocado.
    const originales = [
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
    ] as const;

    for (const category of originales) {
      expect(CATEGORIES).toContain(category);
      expect(isValidCategory(category)).toBe(true);
    }
  });

  it("las 9 nuevas están en su grupo", () => {
    const nuevas = [
      ["Impuestos y tributos", "GASTOS FIJOS"],
      ["Seguros", "GASTOS FIJOS"],
      ["Compras online", "GASTOS VARIABLES"],
      ["Café y snacks", "GASTOS VARIABLES"],
      ["Peajes y estacionamiento", "GASTOS VARIABLES"],
      ["Movilidad Taxi", "GASTOS VARIABLES"],
      ["Cuidado personal", "GASTOS VARIABLES"],
      ["Regalos", "GASTOS VARIABLES"],
      ["Mantenimiento Vehículo", "GASTOS VARIABLES"],
    ] as const;

    for (const [category, group] of nuevas) {
      expect(isValidCategory(category)).toBe(true);
      expect(getGroupForCategory(category)).toBe(group);
    }
  });

  it("los grupos de las categorías originales no cambiaron", () => {
    // Ampliar el catálogo no puede reclasificar lo que ya existía.
    expect(getGroupForCategory("Transporte")).toBe("GASTOS VARIABLES");
    expect(getGroupForCategory("Combustible")).toBe("GASTOS VARIABLES");
    expect(getGroupForCategory("Suscripciones")).toBe("GASTOS FIJOS");
    expect(getGroupForCategory("Servicios")).toBe("GASTOS FIJOS");
    expect(getGroupForCategory("Educación")).toBe("GASTOS FIJOS");
    expect(getGroupForCategory("Ingresos")).toBe("INGRESOS");
    expect(getGroupForCategory("Otros")).toBe("GASTOS VARIABLES");
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

  it("GASTOS FIJOS son los ocho acordados", () => {
    expect(getCategoriesInGroup("GASTOS FIJOS")).toEqual([
      "Suscripciones",
      "Servicios",
      "Luz",
      "Gas Cálidda",
      "Mantenimiento",
      "Educación",
      "Seguros",
      "Impuestos y tributos",
    ]);
  });

  it("isValidGroup rechaza cualquier otra cosa", () => {
    expect(isValidGroup("INGRESOS")).toBe(true);
    expect(isValidGroup("ingresos")).toBe(false);
    expect(isValidGroup("GASTOS")).toBe(false);
    expect(isValidGroup(null)).toBe(false);
  });
});

describe("categoría resumen", () => {
  it("el mapeo acordado, fila por fila", () => {
    const mapeo = [
      ["Ingresos", "Ingresos"],
      ["Suscripciones", "Suscripciones"],
      ["Servicios", "Servicios del hogar"],
      ["Educación", "Educación"],
      ["Seguros", "Seguros e impuestos"],
      ["Impuestos y tributos", "Seguros e impuestos"],
      ["Supermercado", "Alimentación"],
      ["Restaurantes", "Alimentación"],
      ["Delivery", "Alimentación"],
      ["Café y snacks", "Alimentación"],
      ["Transporte", "Movilidad"],
      ["Movilidad Taxi", "Movilidad"],
      ["Peajes y estacionamiento", "Movilidad"],
      ["Combustible", "Vehículo"],
      ["Mantenimiento Vehículo", "Vehículo"],
      ["Salud", "Salud y bienestar"],
      ["Farmacia", "Salud y bienestar"],
      ["Cuidado personal", "Salud y bienestar"],
      ["Entretenimiento", "Entretenimiento"],
      ["Hogar", "Hogar"],
      ["Ropa", "Compras personales"],
      ["Tecnología", "Tecnología y compras"],
      ["Compras online", "Tecnología y compras"],
      ["Regalos", "Regalos"],
      ["Transferencias", "Transferencias"],
      ["Otros", "Otros"],
      ["Luz", "Servicios del hogar"],
      ["Gas Cálidda", "Servicios del hogar"],
      ["Mantenimiento", "Servicios del hogar"],
    ] as const;

    expect(mapeo).toHaveLength(CATEGORIES.length);

    for (const [category, summary] of mapeo) {
      expect(getSummaryForCategory(category)).toBe(summary);
    }
  });

  it("los ejemplos del acuerdo, con su grupo", () => {
    const casos = [
      ["Delivery", "Alimentación", "GASTOS VARIABLES"],
      ["Luz", "Servicios del hogar", "GASTOS FIJOS"],
      ["Seguros", "Seguros e impuestos", "GASTOS FIJOS"],
      ["Combustible", "Vehículo", "GASTOS VARIABLES"],
    ] as const;

    for (const [category, summary, group] of casos) {
      expect(getSummaryForCategory(category)).toBe(summary);
      expect(getGroupForCategory(category)).toBe(group);
    }
  });

  it("toda categoría tiene resumen, y todo resumen tiene grupo", () => {
    for (const category of CATEGORIES) {
      const summary = getSummaryForCategory(category);
      expect(summary).not.toBeNull();
      expect(GROUPS).toContain(getGroupForSummary(summary));
    }
  });

  it("el grupo de una categoría es el de su resumen", () => {
    // La cadena no puede romperse: es la propiedad que sostiene la jerarquía.
    for (const category of CATEGORIES) {
      expect(getGroupForCategory(category)).toBe(
        getGroupForSummary(getSummaryForCategory(category)),
      );
    }
  });

  it("los resúmenes particionan el catálogo sin solaparse", () => {
    const desdeResumenes = SUMMARY_CATEGORIES.flatMap((s) => getCategoriesInSummary(s));

    expect(new Set(desdeResumenes).size).toBe(desdeResumenes.length);
    expect([...desdeResumenes].sort()).toEqual([...CATEGORIES].sort());
  });

  it("todas las categorías de un resumen comparten grupo", () => {
    // Si una se saliera, «Alimentación» aparecería a la vez en dos grupos y la
    // tabla dinámica dejaría de cuadrar.
    for (const summary of SUMMARY_CATEGORIES) {
      const grupos = new Set(getCategoriesInSummary(summary).map(getGroupForCategory));
      expect(grupos.size).toBe(1);
    }
  });

  it("«Servicios del hogar» agrupa las cuatro del acuerdo", () => {
    expect(getCategoriesInSummary("Servicios del hogar").sort()).toEqual([
      "Gas Cálidda",
      "Luz",
      "Mantenimiento",
      "Servicios",
    ]);
  });

  it("«Alimentación» agrupa las cuatro del acuerdo", () => {
    expect(getCategoriesInSummary("Alimentación").sort()).toEqual([
      "Café y snacks",
      "Delivery",
      "Restaurantes",
      "Supermercado",
    ]);
  });

  it("rechaza resúmenes inventados", () => {
    for (const value of ["alimentacion", "Comida", "", null, 42]) {
      expect(isValidSummaryCategory(value)).toBe(false);
    }
    expect(isValidSummaryCategory("Alimentación")).toBe(true);
  });

  it("sin categoría no hay resumen", () => {
    expect(getSummaryForCategory(null)).toBeNull();
    expect(getSummaryForCategory("Cripto")).toBeNull();
  });
});
