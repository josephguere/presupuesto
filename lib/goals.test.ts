import { describe, expect, it } from "vitest";
import { buildGoalProgress, joinMonth, splitMonth, summarizeGoals, type CategoryGoal } from "./goals";
import { getGroupForCategory, getSummaryForCategory, type Category } from "./categories";
import { onlyCounted } from "./transactions";
import type { Transaction } from "@/types/transaction";

/**
 * Cálculo de las metas.
 *
 * `buildGoalProgress` es puro, así que se prueba sin base de datos: entran metas
 * y movimientos, sale el progreso. Lo que se comprueba aquí es justamente lo que
 * ninguna prueba de interfaz vería — qué movimientos entran en el gasto y cuáles
 * no.
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
    cardLast4: "3400",
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

function goal(category: Category, amount: number): CategoryGoal {
  return { id: `g-${category}`, category, month: "2026-09", amount };
}

describe("el ejemplo del acuerdo", () => {
  it("calcula meta, gastado, disponible y porcentaje", () => {
    const progress = buildGoalProgress(
      [goal("Supermercado", 800), goal("Restaurantes", 400), goal("Videojuegos", 200)],
      [
        movement("Supermercado", 520),
        movement("Restaurantes", 350),
        movement("Videojuegos", 50),
      ],
    );

    expect(progress).toMatchObject([
      { category: "Supermercado", gastado: 520, disponible: 280, porcentaje: 65 },
      { category: "Restaurantes", gastado: 350, disponible: 50, porcentaje: 87.5 },
      { category: "Videojuegos", gastado: 50, disponible: 150, porcentaje: 25 },
    ]);
  });

  it("la mitad de la meta es el 50 %", () => {
    const [item] = buildGoalProgress([goal("Hogar", 1000)], [movement("Hogar", 500)]);

    expect(item).toMatchObject({ gastado: 500, disponible: 500, porcentaje: 50 });
  });
});

describe("pasarse de la meta", () => {
  it("el porcentaje supera 100 y el disponible va en negativo", () => {
    // NO se limita a 100 a propósito: pasarse es justo lo que hay que ver.
    const [item] = buildGoalProgress([goal("Hogar", 800)], [movement("Hogar", 1000)]);

    expect(item).toMatchObject({ gastado: 1000, disponible: -200, porcentaje: 125 });
  });
});

describe("qué movimientos entran en el gasto", () => {
  it("un movimiento NO contabilizado no suma", () => {
    const progress = buildGoalProgress(
      [goal("Supermercado", 800)],
      [
        movement("Supermercado", 500),
        movement("Supermercado", 300, { contabilizar: false }),
      ],
    );

    expect(progress[0].gastado).toBe(500);
    expect(progress[0].movimientos).toBe(1);
  });

  it("solo cuentan los de la categoría de la meta", () => {
    const progress = buildGoalProgress(
      [goal("Supermercado", 800)],
      [movement("Supermercado", 500), movement("Delivery", 300)],
    );

    expect(progress[0].gastado).toBe(500);
  });

  it("una meta sin movimientos vale cero, no falla", () => {
    const [item] = buildGoalProgress([goal("Viajes", 1500)], []);

    expect(item).toMatchObject({ gastado: 0, disponible: 1500, porcentaje: 0 });
  });

  it("los movimientos eliminados no llegan hasta aquí", () => {
    // La baja lógica se filtra en la CONSULTA, no en este cálculo: si llegaran,
    // sumarían. Esta prueba fija ese contrato para que nadie llame a
    // `buildGoalProgress` con movimientos sin filtrar.
    const eliminado = movement("Supermercado", 999, {
      deletedAt: "2026-09-20T10:00:00-05:00",
    });

    // `onlyCounted` no mira `deletedAt`: es responsabilidad de `getTransactions`.
    expect(onlyCounted([eliminado])).toHaveLength(1);
  });
});

describe("totales de la cabecera", () => {
  it("suma metas y gastos de todas las categorías", () => {
    const progress = buildGoalProgress(
      [goal("Supermercado", 800), goal("Restaurantes", 400)],
      [movement("Supermercado", 520), movement("Restaurantes", 350)],
    );

    expect(summarizeGoals(progress)).toEqual({
      meta: 1200,
      gastado: 870,
      disponible: 330,
      porcentaje: 72.5,
    });
  });

  it("sin metas no divide entre cero", () => {
    expect(summarizeGoals([])).toEqual({
      meta: 0,
      gastado: 0,
      disponible: 0,
      porcentaje: 0,
    });
  });
});

describe("meses", () => {
  it("van y vuelven sin perder nada", () => {
    expect(splitMonth("2026-09")).toEqual({ year: 2026, month: 9 });
    expect(joinMonth(2026, 9)).toBe("2026-09");
    expect(joinMonth(2026, 12)).toBe("2026-12");
  });

  it("las metas de meses distintos son independientes", () => {
    // Septiembre y octubre se leen por separado; esto fija que el mes viaja en
    // la meta y no se pierde por el camino.
    const septiembre: CategoryGoal = {
      id: "g-1",
      category: "Supermercado",
      month: "2026-09",
      amount: 800,
    };
    const octubre: CategoryGoal = { ...septiembre, id: "g-2", month: "2026-10", amount: 900 };

    expect(buildGoalProgress([septiembre], [])[0].month).toBe("2026-09");
    expect(buildGoalProgress([octubre], [])[0].month).toBe("2026-10");
    expect(buildGoalProgress([octubre], [])[0].amount).toBe(900);
  });
});
