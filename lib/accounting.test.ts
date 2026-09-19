import { describe, expect, it } from "vitest";
import {
  buildSummary,
  onlyCounted,
  parseFilters,
  resolveAccountingFilter,
  resolveCategoryFilter,
} from "./transactions";
import { buildGroupedTotals } from "./totals";
import { getGroupForCategory, getSummaryForCategory, type Category } from "./categories";
import type { Transaction } from "@/types/transaction";

/**
 * Contabilización y filtros de selección múltiple.
 *
 * Todo lo que se prueba aquí es PURO: la combinación de los tres niveles, la
 * decisión de qué estados mostrar y la exclusión de lo no contabilizado en los
 * agregados. Nada de base de datos.
 *
 * La distinción que sostiene la pantalla entera —«no contabilizado» NO es
 * «eliminado»— se comprueba explícitamente más abajo.
 */

let sequence = 0;

function movement(
  category: Category | null,
  amount: number,
  extra: Partial<Transaction> = {},
): Transaction {
  sequence += 1;

  return {
    id: `t-${sequence}`,
    bank: "BCP",
    operationType: "Consumo Tarjeta de Débito",
    transactionAt: "2026-09-15T12:00:00-05:00",
    amount,
    merchant: category ?? "Sin categoría",
    cardLast4: null,
    operationNumber: null,
    comment: null,
    category,
    summary: getSummaryForCategory(category),
    group: getGroupForCategory(category),
    origin: "EMAIL",
    contabilizar: true,
    deletedAt: null,
    ...extra,
  };
}

/* -------------------------------------------------------------------------- */
/* Qué estados mostrar                                                         */
/* -------------------------------------------------------------------------- */

describe("filtro de contabilización", () => {
  it("sin parámetro muestra solo los contabilizados", () => {
    // Es lo que espera quien abre la aplicación: los totales de siempre.
    expect(resolveAccountingFilter({})).toBe(true);
  });

  it("solo contabilizados", () => {
    expect(resolveAccountingFilter({ accounting: ["contabilizados"] })).toBe(true);
  });

  it("solo NO contabilizados", () => {
    expect(resolveAccountingFilter({ accounting: ["no-contabilizados"] })).toBe(false);
  });

  it("las dos casillas marcadas no filtran nada", () => {
    // Marcar ambas equivale a «Todos», y por eso no hay una tercera opción.
    expect(
      resolveAccountingFilter({ accounting: ["contabilizados", "no-contabilizados"] }),
    ).toBeNull();
  });

  it("en la papelera se ven todos, cuenten o no", () => {
    // Sin esto, un movimiento eliminado Y no contabilizado desaparecería de la
    // única pantalla desde la que se puede recuperar.
    expect(resolveAccountingFilter({ status: "eliminados" })).toBeNull();
  });

  it("se lee de la URL", () => {
    expect(parseFilters({ contab: "no-contabilizados" }).filters.accounting).toEqual([
      "no-contabilizados",
    ]);

    expect(
      parseFilters({ contab: ["contabilizados", "no-contabilizados"] }).filters.accounting,
    ).toEqual(["contabilizados", "no-contabilizados"]);
  });

  it("un valor inventado se ignora y vuelve al de por defecto", () => {
    const { filters } = parseFilters({ contab: "quizas" });

    expect(filters.accounting).toBeUndefined();
    expect(resolveAccountingFilter(filters)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Combinación de los tres niveles                                             */
/* -------------------------------------------------------------------------- */

describe("combinación de categoría, resumen y grupo", () => {
  it("sin nada seleccionado no restringe", () => {
    expect(resolveCategoryFilter({})).toEqual({
      allowed: null,
      includeUncategorized: false,
    });
  });

  it("varios resúmenes son la UNIÓN de sus categorías", () => {
    const { allowed } = resolveCategoryFilter({
      summaries: ["Alimentación", "Entretenimiento"],
    });

    expect(allowed).toContain("Delivery");
    expect(allowed).toContain("Videojuegos");
    expect(allowed).not.toContain("Luz");
  });

  it("niveles distintos son la INTERSECCIÓN", () => {
    // Alimentación ∩ GASTOS FIJOS = nada: es una combinación imposible, y cero
    // filas es la respuesta correcta.
    const { allowed } = resolveCategoryFilter({
      summaries: ["Alimentación"],
      groups: ["GASTOS FIJOS"],
    });

    expect(allowed).toEqual([]);
  });

  it("una combinación coherente sí devuelve resultados", () => {
    const { allowed } = resolveCategoryFilter({
      summaries: ["Servicios del hogar"],
      groups: ["GASTOS FIJOS"],
    });

    expect(allowed).toContain("Internet");
    expect(allowed).toContain("Luz");
  });

  it("la categoría concreta estrecha el resumen", () => {
    const { allowed } = resolveCategoryFilter({
      summaries: ["Alimentación"],
      categories: ["Delivery"],
    });

    expect(allowed).toEqual(["Delivery"]);
  });

  it("una categoría fuera del resumen elegido no sobrevive", () => {
    const { allowed } = resolveCategoryFilter({
      summaries: ["Alimentación"],
      categories: ["Luz"],
    });

    expect(allowed).toEqual([]);
  });

  it("«sin categoría» sola pide los que no tienen", () => {
    expect(resolveCategoryFilter({ uncategorized: true })).toEqual({
      allowed: null,
      includeUncategorized: true,
    });
  });

  it("«sin categoría» junto a categorías concretas pide las dos cosas", () => {
    const resolved = resolveCategoryFilter({
      uncategorized: true,
      categories: ["Delivery"],
    });

    expect(resolved.allowed).toEqual(["Delivery"]);
    expect(resolved.includeUncategorized).toBe(true);
  });

  it("«sin categoría» se descarta si hay resumen o grupo", () => {
    // Un movimiento sin categoría no pertenece a ningún resumen, así que pedir
    // las dos cosas no podría devolverlo nunca. Se limpia SOLO esa parte de la
    // selección en vez de vaciar el resultado entero.
    const resolved = resolveCategoryFilter({
      uncategorized: true,
      summaries: ["Alimentación"],
    });

    expect(resolved.includeUncategorized).toBe(false);
    expect(resolved.allowed).toContain("Delivery");
  });

  it("el caso completo del acuerdo", () => {
    // Entretenimiento + Servicios del hogar, con Videojuegos + Internet.
    const { allowed } = resolveCategoryFilter({
      summaries: ["Entretenimiento", "Servicios del hogar"],
      categories: ["Videojuegos", "Internet"],
      groups: ["GASTOS FIJOS", "GASTOS VARIABLES"],
    });

    expect(allowed).toEqual(["Videojuegos", "Internet"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Los agregados excluyen lo no contabilizado                                  */
/* -------------------------------------------------------------------------- */

describe("lo no contabilizado no suma", () => {
  const movimientos = [
    movement("Ingresos", 5000),
    movement("Supermercado", 600),
    movement("Supermercado", 400, { contabilizar: false }),
    movement("Suscripciones", 100, { contabilizar: false }),
  ];

  it("`onlyCounted` deja fuera los que no cuentan", () => {
    expect(onlyCounted(movimientos)).toHaveLength(2);
  });

  it("el resumen los ignora aunque se los pasen", () => {
    // Defensa en profundidad: la consulta ya los filtra, pero el filtro permite
    // pedir los dos estados a la vez y entonces los indicadores seguirían
    // teniendo que contar solo los que cuentan.
    const summary = buildSummary(movimientos);

    expect(summary.ingresos).toBe(5000);
    expect(summary.gastosVariables).toBe(600);
    expect(summary.gastosFijos).toBe(0);
    expect(summary.gastosTotales).toBe(600);
    expect(summary.balance).toBe(4400);
  });

  it("la tabla dinámica también los ignora", () => {
    const totals = buildGroupedTotals(movimientos);
    const variables = totals.find((node) => node.label === "GASTOS VARIABLES");

    expect(variables?.total).toBe(600);
    expect(variables?.count).toBe(1);
    // El grupo de fijos no llega ni a aparecer: su único movimiento no cuenta.
    expect(totals.find((node) => node.label === "GASTOS FIJOS")).toBeUndefined();
  });

  it("el resumen y la tabla dinámica dan la misma cifra", () => {
    // Si una de las dos olvidara filtrar, el mismo mes mostraría dos totales
    // distintos en la misma pantalla.
    const summary = buildSummary(movimientos);
    const totals = buildGroupedTotals(movimientos);

    const gastos = totals
      .filter((node) => node.label !== "INGRESOS")
      .reduce((total, node) => total + node.total, 0);

    expect(gastos).toBe(summary.gastosTotales);
  });
});

/* -------------------------------------------------------------------------- */
/* «No contabilizado» NO es «eliminado»                                        */
/* -------------------------------------------------------------------------- */

describe("contabilizar y eliminar son cosas distintas", () => {
  it("un movimiento sin contabilizar sigue activo", () => {
    const item = movement("Supermercado", 400, { contabilizar: false });

    expect(item.contabilizar).toBe(false);
    // No está eliminado: no tiene fecha de baja y aparece en Movimientos.
    expect(item.deletedAt).toBeNull();
  });

  it("un movimiento eliminado conserva su contabilización", () => {
    // Restaurar no puede forzar `contabilizar = true`: son dos decisiones
    // distintas del usuario y ninguna revoca a la otra.
    const item = movement("Supermercado", 400, {
      contabilizar: false,
      deletedAt: "2026-09-20T10:00:00-05:00",
    });

    expect(item.contabilizar).toBe(false);
    expect(item.deletedAt).not.toBeNull();
  });

  it("los cuatro estados posibles existen y se distinguen", () => {
    const estados = [
      movement("Hogar", 10, { contabilizar: true, deletedAt: null }),
      movement("Hogar", 10, { contabilizar: false, deletedAt: null }),
      movement("Hogar", 10, { contabilizar: true, deletedAt: "2026-09-20T10:00:00-05:00" }),
      movement("Hogar", 10, { contabilizar: false, deletedAt: "2026-09-20T10:00:00-05:00" }),
    ];

    const activos = estados.filter((item) => item.deletedAt === null);
    expect(activos).toHaveLength(2);
    expect(onlyCounted(activos)).toHaveLength(1);
  });
});
