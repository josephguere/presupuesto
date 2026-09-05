import { describe, expect, it } from "vitest";
import {
  buildGroupedTotals,
  buildSummary,
  getCurrentMonth,
  isValidDate,
  parseFilters,
  withDefaultMonth,
} from "./transactions";
import { getGroupForCategory, getSummaryForCategory, type Category } from "./categories";
import type { Transaction } from "@/types/transaction";

/**
 * Indicadores, totales por categoría y lectura de filtros.
 *
 * Los agregados se prueban sin base de datos: `buildSummary` recibe movimientos
 * ya filtrados y devuelve números. Esa separación es justo lo que permite
 * probar el cálculo sin montar Supabase.
 */

let sequence = 0;

/** Movimiento de prueba; el grupo se deriva igual que en producción. */
function movement(category: Category | null, amount: number, extra: Partial<Transaction> = {}) {
  sequence += 1;
  return {
    id: `t-${sequence}`,
    bank: "BCP",
    operationType: "Consumo Tarjeta de Débito",
    transactionAt: "2026-08-15T12:00:00-05:00",
    amount,
    merchant: category ?? "Sin categoría",
    cardLast4: "3400",
    operationNumber: null,
    comment: null,
    category,
    summary: getSummaryForCategory(category),
    group: getGroupForCategory(category),
    origin: "EMAIL",
    deletedAt: null,
    ...extra,
  } satisfies Transaction;
}

describe("buildSummary — el ejemplo acordado", () => {
  const transactions = [
    movement("Ingresos", 5000),
    movement("Suscripciones", 100),
    movement("Supermercado", 600),
  ];

  const summary = buildSummary(transactions);

  it("INGRESOS = 5,000", () => expect(summary.ingresos).toBe(5000));
  it("GASTOS FIJOS = 100", () => expect(summary.gastosFijos).toBe(100));
  it("GASTOS VARIABLES = 600", () => expect(summary.gastosVariables).toBe(600));
  it("GASTOS TOTALES = 700", () => expect(summary.gastosTotales).toBe(700));
  it("BALANCE = 4,300", () => expect(summary.balance).toBe(4300));
});

describe("buildSummary — casos que importan", () => {
  it("los ingresos no cuentan como gasto", () => {
    const summary = buildSummary([movement("Ingresos", 5000), movement("Delivery", 50)]);

    expect(summary.totalSpent).toBe(50);
    expect(summary.transactionCount).toBe(1);
    expect(summary.largestAmount).toBe(50);
  });

  it("lo no categorizado NO se reparte entre fijos y variables", () => {
    // Es lo que impide que el balance parezca correcto sin serlo.
    const summary = buildSummary([
      movement("Ingresos", 1000),
      movement("Supermercado", 200),
      movement(null, 999),
    ]);

    expect(summary.gastosFijos).toBe(0);
    expect(summary.gastosVariables).toBe(200);
    expect(summary.gastosTotales).toBe(200);
    expect(summary.pendienteCategorizar).toBe(999);
    expect(summary.pendienteCategorizarCount).toBe(1);
  });

  it("el balance puede ser negativo", () => {
    const summary = buildSummary([movement("Ingresos", 100), movement("Hogar", 350)]);
    expect(summary.balance).toBe(-250);
  });

  it("sin movimientos, todo a cero y sin dividir por cero", () => {
    const summary = buildSummary([]);
    expect(summary).toMatchObject({
      ingresos: 0,
      gastosTotales: 0,
      balance: 0,
      averageAmount: 0,
      largestAmount: 0,
    });
  });

  it("no arrastra errores de coma flotante", () => {
    // 0.1 + 0.2 = 0.30000000000000004 sin redondeo.
    const summary = buildSummary([movement("Delivery", 0.1), movement("Delivery", 0.2)]);
    expect(summary.gastosVariables).toBe(0.3);
  });

  it("promedio y mayor gasto ignoran los ingresos", () => {
    const summary = buildSummary([
      movement("Ingresos", 10000),
      movement("Ropa", 100),
      movement("Ropa", 300),
    ]);

    expect(summary.averageAmount).toBe(200);
    expect(summary.largestAmount).toBe(300);
  });
});

describe("buildGroupedTotals", () => {
  const arbol = buildGroupedTotals([
    movement("Delivery", 200),
    movement("Delivery", 44.6),
    movement("Supermercado", 74),
    movement("Restaurantes", 100),
    movement("Transporte", 80),
    movement("Luz", 180),
    movement("Servicios", 100),
  ]);

  /** Busca un nodo por su etiqueta en todo el árbol. */
  function buscar(label: string) {
    const pila = [...arbol];
    while (pila.length > 0) {
      const nodo = pila.shift()!;
      if (nodo.label === label) return nodo;
      pila.push(...nodo.children);
    }
    return undefined;
  }

  it("agrupa en tres niveles: grupo, resumen y categoría", () => {
    expect(arbol.map((g) => g.label).sort()).toEqual(["GASTOS FIJOS", "GASTOS VARIABLES"]);

    const variables = buscar("GASTOS VARIABLES")!;
    expect(variables.children.map((c) => c.label).sort()).toEqual(["Alimentación", "Movilidad"]);

    const alimentacion = buscar("Alimentación")!;
    expect(alimentacion.children.map((c) => c.label).sort()).toEqual([
      "Delivery",
      "Restaurantes",
      "Supermercado",
    ]);
  });

  it("el total de una categoría suma sus movimientos", () => {
    expect(buscar("Delivery")).toMatchObject({ total: 244.6, count: 2 });
  });

  it("el total de un resumen suma sus categorías", () => {
    // 244.60 + 74 + 100
    expect(buscar("Alimentación")).toMatchObject({ total: 418.6, count: 4 });
  });

  it("el total de un grupo suma sus resúmenes", () => {
    // Alimentación 418.60 + Movilidad 80
    expect(buscar("GASTOS VARIABLES")).toMatchObject({ total: 498.6, count: 5 });
  });

  it("los tres niveles cuadran entre sí", () => {
    // Se suma de abajo arriba, así que esto no puede fallar por construcción;
    // la prueba está para que siga siendo así si alguien cambia el cálculo.
    for (const grupo of arbol) {
      const suma = grupo.children.reduce((t, c) => t + c.total, 0);
      expect(grupo.total).toBeCloseTo(suma, 2);

      for (const resumen of grupo.children) {
        const sumaCategorias = resumen.children.reduce((t, c) => t + c.total, 0);
        expect(resumen.total).toBeCloseTo(sumaCategorias, 2);
      }
    }
  });

  it("categorías distintas del mismo resumen se agrupan juntas", () => {
    // «Luz» y «Servicios» son ambas de «Servicios del hogar».
    const hogar = buscar("Servicios del hogar")!;
    expect(hogar.total).toBe(280);
    expect(hogar.children.map((c) => c.label).sort()).toEqual(["Luz", "Servicios"]);
  });

  it("lo que no tiene categoría va a su propia rama", () => {
    const conHuerfano = buildGroupedTotals([movement("Delivery", 50), movement(null, 999)]);
    const etiquetas = conHuerfano.map((g) => g.label);

    expect(etiquetas).toContain("Sin categoría");
    // Y no contamina el grupo real.
    expect(conHuerfano.find((g) => g.label === "GASTOS VARIABLES")!.total).toBe(50);
  });

  it("sin movimientos no hay filas", () => {
    expect(buildGroupedTotals([])).toEqual([]);
  });
});

describe("orden de los totales", () => {
  const movimientos = [
    movement("Delivery", 244),
    movement("Supermercado", 74),
    movement("Restaurantes", 60),
    movement("Suscripciones", 500),
  ];

  it("por defecto, de mayor a menor", () => {
    const arbol = buildGroupedTotals(movimientos);
    expect(arbol.map((g) => g.label)).toEqual(["GASTOS FIJOS", "GASTOS VARIABLES"]);

    const alimentacion = arbol[1].children[0];
    expect(alimentacion.children.map((c) => c.label)).toEqual([
      "Delivery",
      "Supermercado",
      "Restaurantes",
    ]);
  });

  it("«menor» invierte cada nivel", () => {
    const arbol = buildGroupedTotals(movimientos, "menor");
    expect(arbol.map((g) => g.label)).toEqual(["GASTOS VARIABLES", "GASTOS FIJOS"]);

    const alimentacion = arbol[0].children[0];
    expect(alimentacion.children.map((c) => c.label)).toEqual([
      "Restaurantes",
      "Supermercado",
      "Delivery",
    ]);
  });

  it("ordenar NUNCA saca a una categoría de su resumen", () => {
    // Es la regla que impide que la tabla dinámica deje de serlo.
    for (const order of ["mayor", "menor"] as const) {
      for (const grupo of buildGroupedTotals(movimientos, order)) {
        for (const resumen of grupo.children) {
          for (const categoria of resumen.children) {
            expect(categoria.key.startsWith(`${resumen.key}/`)).toBe(true);
          }
          expect(resumen.key.startsWith(`${grupo.key}/`)).toBe(true);
        }
      }
    }
  });
});

describe("parseFilters", () => {
  it("por defecto no fuerza ningún filtro", () => {
    const { filters, mode } = parseFilters({});
    expect(mode).toBe("month");
    expect(filters).toEqual({});
  });

  it("lee un mes válido", () => {
    expect(parseFilters({ mes: "2026-08" }).filters).toEqual({ month: "2026-08" });
  });

  it("descarta un mes inválido en lugar de fallar", () => {
    for (const mes of ["2026-13", "agosto", "2026-8", ""]) {
      expect(parseFilters({ mes }).filters.month).toBeUndefined();
    }
  });

  it("el rango personalizado tiene prioridad sobre el mes", () => {
    const { filters, mode } = parseFilters({
      mes: "2026-08",
      desde: "2026-07-01",
      hasta: "2026-07-31",
    });

    expect(mode).toBe("range");
    expect(filters.from).toBe("2026-07-01");
    expect(filters.to).toBe("2026-07-31");
    expect(filters.month).toBeUndefined();
  });

  it("lee categoría y grupo", () => {
    const { filters } = parseFilters({ categoria: "Restaurantes", grupo: "GASTOS VARIABLES" });
    expect(filters.category).toBe("Restaurantes");
    expect(filters.group).toBe("GASTOS VARIABLES");
  });

  it("combina período, grupo y categoría", () => {
    // El ejemplo del acuerdo: Agosto 2026 · GASTOS VARIABLES · Restaurantes.
    const { filters } = parseFilters({
      mes: "2026-08",
      grupo: "GASTOS VARIABLES",
      categoria: "Restaurantes",
    });

    expect(filters).toEqual({
      month: "2026-08",
      group: "GASTOS VARIABLES",
      category: "Restaurantes",
    });
  });

  it("reconoce el filtro de «sin categoría»", () => {
    const { filters } = parseFilters({ categoria: "__sin_categoria__" });
    expect(filters.uncategorized).toBe(true);
    expect(filters.category).toBeUndefined();
  });

  it("ignora categorías y grupos inventados", () => {
    const { filters } = parseFilters({ categoria: "Cripto", grupo: "GASTOS SECRETOS" });
    expect(filters.category).toBeUndefined();
    expect(filters.group).toBeUndefined();
  });

  it("se queda con el primer valor si el parámetro se repite", () => {
    expect(parseFilters({ mes: ["2026-08", "2026-07"] }).filters.month).toBe("2026-08");
  });
});

describe("isValidDate", () => {
  it("acepta AAAA-MM-DD y rechaza el resto", () => {
    expect(isValidDate("2026-08-29")).toBe(true);
    expect(isValidDate("29/08/2026")).toBe(false);
    expect(isValidDate("")).toBe(false);
    expect(isValidDate(undefined)).toBe(false);
  });
});

describe("mes en curso por defecto", () => {
  // El objetivo es de rendimiento: el mes acaba en el WHERE de la consulta, así
  // que entrar a cualquiera de las dos pantallas lee un mes y no el histórico.
  it("sin parámetros, filtra por el mes actual", () => {
    const filters = withDefaultMonth(parseFilters({}));

    expect(filters.month).toBe(getCurrentMonth());
  });

  it("respeta el mes que elija el usuario", () => {
    const filters = withDefaultMonth(parseFilters({ mes: "2026-03" }));

    expect(filters.month).toBe("2026-03");
  });

  it("«Todos los meses» consulta todo, como pide el usuario", () => {
    // El desplegable manda `mes=` vacío. Sin distinguirlo de «no hay parámetro»,
    // la pantalla volvería a imponer el mes actual y la opción no serviría.
    const filters = withDefaultMonth(parseFilters({ mes: "" }));

    expect(filters.month).toBeUndefined();
  });

  it("un rango personalizado manda sobre el mes por defecto", () => {
    const filters = withDefaultMonth(
      parseFilters({ desde: "2026-01-01", hasta: "2026-01-31" }),
    );

    expect(filters.month).toBeUndefined();
    expect(filters.from).toBe("2026-01-01");
    expect(filters.to).toBe("2026-01-31");
  });

  it("un mes inválido cae en el mes actual, no en «todo»", () => {
    // Una URL manipulada no debe convertirse en una consulta del histórico.
    for (const mes of ["2026-13", "agosto", "2026-8"]) {
      expect(withDefaultMonth(parseFilters({ mes })).month).toBe(getCurrentMonth());
    }
  });

  it("conserva el resto de filtros", () => {
    const filters = withDefaultMonth(
      parseFilters({ categoria: "Seguros", grupo: "GASTOS FIJOS" }),
    );

    expect(filters.month).toBe(getCurrentMonth());
    expect(filters.category).toBe("Seguros");
    expect(filters.group).toBe("GASTOS FIJOS");
  });

  it("las categorías nuevas se pueden filtrar", () => {
    for (const categoria of ["Peajes y estacionamiento", "Café y snacks", "Movilidad Taxi"]) {
      expect(parseFilters({ categoria }).filters.category).toBe(categoria);
    }
  });
});

describe("filtro por categoría resumen", () => {
  it("lee el parámetro de la URL", () => {
    const { filters } = parseFilters({ categoriaResumen: "Alimentación" });
    expect(filters.summary).toBe("Alimentación");
  });

  it("ignora resúmenes inventados", () => {
    expect(parseFilters({ categoriaResumen: "Comida" }).filters.summary).toBeUndefined();
    expect(parseFilters({ categoriaResumen: "" }).filters.summary).toBeUndefined();
  });

  it("se combina con el resto sin pisarlos", () => {
    const { filters } = parseFilters({
      mes: "2026-08",
      categoriaResumen: "Servicios del hogar",
      grupo: "GASTOS FIJOS",
    });

    expect(filters).toEqual({
      month: "2026-08",
      summary: "Servicios del hogar",
      group: "GASTOS FIJOS",
    });
  });

  it("se repinta en el formulario", () => {
    expect(parseFilters({ categoriaResumen: "Movilidad" }).raw.summary).toBe("Movilidad");
  });
});
