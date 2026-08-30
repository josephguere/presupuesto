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

  const query = {
    select(columns: string) {
      state.selected = columns;
      return query;
    },
    order: () => query,
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
      return Promise.resolve({ data, error: null });
    },
  };

  return query;
}

const { getTransactions, getAvailableMonths, buildSummary, buildCategoryTotals } = await import(
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

  it("un eliminado no suma en el resumen por categoría", async () => {
    const totals = buildCategoryTotals(await getTransactions());

    expect(totals).toHaveLength(1);
    expect(totals[0]).toMatchObject({ category: "Supermercado", total: 100, count: 1 });
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
