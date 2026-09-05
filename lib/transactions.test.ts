import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lectura de movimientos con eliminación lógica.
 *
 * El doble de Supabase no se limita a devolver filas: APLICA los filtros que le
 * llegan (`eq`, `is`, `in`, `gte`, `lt`). Sin eso, una prueba pasaría igual
 * aunque el filtro de `activo` no existiera, que es justo el error que hay que
 * poder detectar aquí.
 */

interface Row {
  [column: string]: unknown;
}

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  /** Columnas pedidas en el último `select`, para comprobar el proyectado. */
  selected: "",
}));

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({
    from: () => createQuery(),
  }),
}));

/** Constructor de consultas encadenable, con los filtros que usa la app. */
function createQuery() {
  const equals: Array<[string, unknown]> = [];
  const nulls: string[] = [];
  const notNulls: string[] = [];
  const inLists: Array<[string, unknown[]]> = [];
  const ranges: Array<[string, "gte" | "lt", string]> = [];

  const orders: Array<[string, boolean]> = [];

  const query = {
    select(columns: string) {
      state.selected = columns;
      return query;
    },
    order(column: string, options?: { ascending?: boolean }) {
      orders.push([column, options?.ascending ?? true]);
      return query;
    },
    limit: () => query,
    eq(column: string, value: unknown) {
      equals.push([column, value]);
      return query;
    },
    is(column: string, value: unknown) {
      if (value === null) nulls.push(column);
      return query;
    },
    not(column: string, _operator: string, value: unknown) {
      if (value === null) notNulls.push(column);
      return query;
    },
    in(column: string, values: unknown[]) {
      inLists.push([column, values]);
      return query;
    },
    gte(column: string, value: string) {
      ranges.push([column, "gte", value]);
      return query;
    },
    lt(column: string, value: string) {
      ranges.push([column, "lt", value]);
      return query;
    },
    returns() {
      const data = state.rows.filter(
        (row) =>
          equals.every(([column, value]) => row[column] === value) &&
          nulls.every((column) => row[column] === null) &&
          notNulls.every((column) => row[column] !== null) &&
          inLists.every(([column, values]) => values.includes(row[column])) &&
          ranges.every(([column, operator, value]) => {
            const actual = String(row[column]);
            return operator === "gte" ? actual >= value : actual < value;
          }),
      );

      // PostgreSQL ordena por las columnas en el orden en que se piden, y el
      // desempate importa: es lo que decide qué se ve primero entre dos gastos
      // del mismo importe.
      const ordenado = [...data].sort((a, b) => {
        for (const [column, ascending] of orders) {
          const izquierda = a[column];
          const derecha = b[column];
          if (izquierda === derecha) continue;

          const comparacion =
            column === "amount"
              ? Number(izquierda) - Number(derecha)
              : String(izquierda).localeCompare(String(derecha));

          return ascending ? comparacion : -comparacion;
        }
        return 0;
      });

      return Promise.resolve({ data: ordenado, error: null });
    },
  };

  return query;
}

const { getTransactions, getAvailableMonths, buildSummary, buildGroupedTotals } = await import(
  "./transactions"
);

/** Fila tal como la devuelve PostgreSQL. */
function row(overrides: Row = {}): Row {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    bank: "BCP",
    operation_type: "Consumo Tarjeta de Débito",
    transaction_at: "2026-08-15T12:00:00-05:00",
    amount: "100.00",
    currency: "PEN",
    merchant: "PLAZA VEA",
    card_last4: "3400",
    operation_number: null,
    category: "Supermercado",
    comment: null,
    origin: "EMAIL",
    activo: true,
    eliminado_at: null,
    is_test: false,
    ...overrides,
  };
}

const ACTIVO = row({ id: "a-1", merchant: "ACTIVO", amount: "100.00" });
const ELIMINADO = row({
  id: "b-2",
  merchant: "ELIMINADO",
  amount: "999.00",
  activo: false,
  eliminado_at: "2026-08-20T10:30:00-05:00",
});

beforeEach(() => {
  state.rows = [ACTIVO, ELIMINADO];
  state.selected = "";
});

describe("getTransactions — eliminación lógica", () => {
  it("por defecto devuelve solo los activos", async () => {
    const transactions = await getTransactions();

    expect(transactions.map((t) => t.merchant)).toEqual(["ACTIVO"]);
  });

  it("un movimiento eliminado no aparece ni con filtros puestos", async () => {
    // La baja manda sobre cualquier otro filtro: aunque el usuario pida
    // exactamente su mes y su categoría, no debe reaparecer.
    const transactions = await getTransactions({
      month: "2026-08",
      category: "Supermercado",
    });

    expect(transactions.map((t) => t.merchant)).toEqual(["ACTIVO"]);
  });

  it("«eliminados» devuelve solo los dados de baja", async () => {
    const transactions = await getTransactions({ status: "eliminados" });

    expect(transactions.map((t) => t.merchant)).toEqual(["ELIMINADO"]);
  });

  it("expone la fecha de baja para poder mostrarla", async () => {
    const [eliminado] = await getTransactions({ status: "eliminados" });

    expect(eliminado.deletedAt).toBe("2026-08-20T10:30:00-05:00");
    expect(state.selected).toContain("eliminado_at");
  });

  it("los activos no traen fecha de baja", async () => {
    const [activo] = await getTransactions();
    expect(activo.deletedAt).toBeNull();
  });

  it("el grupo se sigue derivando de la categoría", async () => {
    state.rows = [row({ category: "Suscripciones" })];
    const [transaction] = await getTransactions();

    expect(transaction.category).toBe("Suscripciones");
    expect(transaction.group).toBe("GASTOS FIJOS");
  });
});

describe("indicadores y totales tras eliminar", () => {
  it("un eliminado no suma en ningún indicador", async () => {
    const summary = buildSummary(await getTransactions());

    // Los 999 del movimiento eliminado no aparecen por ninguna parte.
    expect(summary.gastosVariables).toBe(100);
    expect(summary.gastosTotales).toBe(100);
    expect(summary.totalSpent).toBe(100);
    expect(summary.transactionCount).toBe(1);
    expect(summary.averageAmount).toBe(100);
    expect(summary.largestAmount).toBe(100);
    expect(summary.balance).toBe(-100);
  });

  it("un eliminado no suma en la tabla de totales", async () => {
    const totals = buildGroupedTotals(await getTransactions());

    expect(totals).toHaveLength(1);
    expect(totals[0]).toMatchObject({ label: "GASTOS VARIABLES", total: 100, count: 1 });
    expect(totals[0].children[0]).toMatchObject({ label: "Alimentación", total: 100 });
  });

  it("al restaurarlo vuelve a contar", async () => {
    // Restaurar es exactamente esto en base de datos: activo pasa a true.
    state.rows = [ACTIVO, { ...ELIMINADO, activo: true, eliminado_at: null }];

    const summary = buildSummary(await getTransactions());

    expect(summary.gastosVariables).toBe(1099);
    expect(summary.transactionCount).toBe(2);
    expect(summary.largestAmount).toBe(999);
  });
});

describe("getAvailableMonths", () => {
  it("ofrece los meses de los movimientos activos", async () => {
    state.rows = [
      row({ transaction_at: "2026-08-15T12:00:00-05:00" }),
      row({ transaction_at: "2026-03-02T12:00:00-05:00", activo: false, eliminado_at: "x" }),
    ];

    const months = await getAvailableMonths();

    expect(months).toContain("2026-08");
    expect(months).not.toContain("2026-03");
  });

  it("en la papelera ofrece los meses de las bajas", async () => {
    state.rows = [
      row({ transaction_at: "2026-08-15T12:00:00-05:00" }),
      row({ transaction_at: "2026-03-02T12:00:00-05:00", activo: false, eliminado_at: "x" }),
    ];

    const months = await getAvailableMonths("eliminados");

    expect(months).toContain("2026-03");
    expect(months).not.toContain("2026-08");
  });
});

describe("orden por monto", () => {
  beforeEach(() => {
    state.rows = [
      row({ id: "1", merchant: "GRANDE", amount: "156.80", transaction_at: "2026-08-01T10:00:00-05:00" }),
      row({ id: "2", merchant: "MEDIANO", amount: "80.00", transaction_at: "2026-08-02T10:00:00-05:00" }),
      row({ id: "3", merchant: "OTRO", amount: "74.00", transaction_at: "2026-08-03T10:00:00-05:00" }),
      row({ id: "4", merchant: "CHICO-VIEJO", amount: "3.90", transaction_at: "2026-08-04T10:00:00-05:00" }),
      row({ id: "5", merchant: "CHICO-NUEVO", amount: "3.90", transaction_at: "2026-08-05T10:00:00-05:00" }),
    ];
  });

  it("por defecto, lo más reciente primero", async () => {
    const orden = (await getTransactions()).map((t) => t.merchant);
    expect(orden[0]).toBe("CHICO-NUEVO");
    expect(orden.at(-1)).toBe("GRANDE");
  });

  it("«monto-desc» compara números, no el texto formateado", async () => {
    // Como cadenas, "80.00" iría antes que "156.80" y "3.90" antes que "74.00".
    const orden = await getTransactions({ sort: "monto-desc" });

    expect(orden.map((t) => t.amount)).toEqual([156.8, 80, 74, 3.9, 3.9]);
  });

  it("«monto-asc» invierte", async () => {
    const orden = await getTransactions({ sort: "monto-asc" });
    expect(orden.map((t) => t.amount)).toEqual([3.9, 3.9, 74, 80, 156.8]);
  });

  it("a igual monto, primero el más reciente", async () => {
    // Los dos de 3.90 tienen que salir en un orden definido, no arbitrario.
    for (const sort of ["monto-desc", "monto-asc"] as const) {
      const empatados = (await getTransactions({ sort }))
        .filter((t) => t.amount === 3.9)
        .map((t) => t.merchant);

      expect(empatados).toEqual(["CHICO-NUEVO", "CHICO-VIEJO"]);
    }
  });

  it("no pierde decimales", async () => {
    const orden = await getTransactions({ sort: "monto-desc" });
    expect(orden.map((t) => t.amount)).toContain(156.8);
    expect(orden.map((t) => t.amount)).toContain(3.9);
  });

  it("«antiguos» ordena al revés por fecha", async () => {
    const orden = (await getTransactions({ sort: "antiguos" })).map((t) => t.merchant);
    expect(orden[0]).toBe("GRANDE");
    expect(orden.at(-1)).toBe("CHICO-NUEVO");
  });

  it("primero se filtra y después se ordena", async () => {
    const orden = await getTransactions({ sort: "monto-desc", category: "Supermercado" });

    // Todas las filas de prueba son Supermercado, así que el filtro no quita
    // ninguna; lo que se comprueba es que el orden sobrevive al filtrado.
    expect(orden).toHaveLength(5);
    expect(orden[0].amount).toBe(156.8);
  });

  it("un eliminado sigue fuera, se ordene como se ordene", async () => {
    state.rows = [
      ...state.rows,
      row({ id: "6", merchant: "BORRADO", amount: "9999.00", activo: false, eliminado_at: "x" }),
    ];

    const orden = await getTransactions({ sort: "monto-desc" });
    expect(orden.map((t) => t.merchant)).not.toContain("BORRADO");
  });
});
