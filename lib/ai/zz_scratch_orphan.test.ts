import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row { [column: string]: unknown }
const state = vi.hoisted(() => ({ rows: [] as Row[] }));

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({ from: () => createQuery() }),
}));

function createQuery() {
  const equals: Array<[string, unknown]> = [];
  const nulls: string[] = [];
  const inLists: Array<[string, unknown[]]> = [];
  const ranges: Array<[string, "gte" | "lt", string]> = [];
  const query = {
    select: () => query,
    order: () => query,
    limit: () => query,
    abortSignal: () => query,
    eq(c: string, v: unknown) { equals.push([c, v]); return query; },
    is(c: string, v: unknown) { if (v === null) nulls.push(c); return query; },
    not: () => query,
    in(c: string, v: unknown[]) { inLists.push([c, v]); return query; },
    gte(c: string, v: string) { ranges.push([c, "gte", v]); return query; },
    lt(c: string, v: string) { ranges.push([c, "lt", v]); return query; },
    returns() {
      const data = state.rows.filter((row) =>
        equals.every(([c, v]) => row[c] === v) &&
        nulls.every((c) => row[c] === null) &&
        inLists.every(([c, v]) => v.includes(row[c])) &&
        ranges.every(([c, op, v]) => {
          const actual = String(row[c]);
          return op === "gte" ? actual >= v : actual < v;
        }));
      return Promise.resolve({ data, error: null });
    },
  };
  return query;
}

const { executeIntent } = await import("./execute");
const { buildCatalog } = await import("./catalog");
const { parseIntent } = await import("./intent");
const { toAnswerPayload, toChatResult } = await import("./present");
const { resolvePeriod } = await import("@/lib/period");

const AHORA = new Date("2026-09-15T17:00:00Z");
// Catálogo con la huérfana "Mascotas" (6 movimientos en datos, no en el código).
const catalogo = buildCatalog([{ category: "Mascotas", movimientos: 6 }]);

function row(overrides: Row = {}): Row {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    bank: "BCP",
    operation_type: "Consumo",
    transaction_at: "2026-09-10T12:00:00-05:00",
    amount: "80.00",
    currency: "PEN",
    merchant: "VETERINARIA CANINA",
    card_last4: "3400",
    operation_number: "000123456",
    category: "Mascotas",
    comment: null,
    origin: "EMAIL",
    activo: true,
    is_test: false,
    eliminado_at: null,
    ...overrides,
  };
}

async function ejecutar(respuesta: Record<string, unknown>) {
  const parsed = parseIntent({
    enAlcance: true, periodoDias: 0, periodoMes: 0, periodoAno: 0,
    periodoDesde: "", periodoHasta: "", periodoComparado: "NINGUNA",
    metrica: "gastos", categoria: "NINGUNA", categoriaResumen: "NINGUNA",
    grupo: "NINGUNA", sinCategoria: false, comercio: "", orden: "recientes",
    limite: 0, periodo: "este_mes", ...respuesta,
  }, catalogo, AHORA);
  if (!parsed.ok) throw new Error(`rechazada: ${JSON.stringify(parsed.rechazo)}`);
  const period = resolvePeriod(parsed.intent.periodo, AHORA);
  return { intent: parsed.intent, result: await executeIntent(parsed.intent, period, {}) };
}

beforeEach(() => { state.rows = []; });

describe("categoria huerfana", () => {
  it("category_total de Mascotas", async () => {
    state.rows = Array.from({ length: 6 }, (_, i) => row({ id: `id-${i}` }));
    const { intent, result } = await ejecutar({ intencion: "category_total", categoria: "Mascotas" });
    console.log("INTENCION EJECUTADA:", intent.intencion, JSON.stringify(intent.filtros));
    console.log("METRICAS:", JSON.stringify(result.metricas, null, 1));
    console.log("VACIO:", result.vacio, "TOTALFILAS:", result.totalFilas, "FILAS:", result.filas.length);
    console.log("PAYLOAD A GEMINI:", JSON.stringify(toAnswerPayload(result), null, 1));
    console.log("CHAT RESULT:", JSON.stringify(toChatResult(result), null, 1));
    expect(true).toBe(true);
  });

  it("transaction_list de Mascotas (comparacion)", async () => {
    state.rows = Array.from({ length: 6 }, (_, i) => row({ id: `id-${i}` }));
    const { result } = await ejecutar({ intencion: "transaction_list", categoria: "Mascotas" });
    console.log("LIST METRICAS:", JSON.stringify(result.metricas));
    console.log("LIST FILAS:", result.filas.length);
  });

  it("category_breakdown con huerfanas presentes", async () => {
    state.rows = [
      ...Array.from({ length: 6 }, (_, i) => row({ id: `m-${i}` })),
      row({ id: "s-1", category: "Supermercado", amount: "50.00" }),
    ];
    const { result } = await ejecutar({ intencion: "category_breakdown" });
    console.log("BREAKDOWN METRICAS:", JSON.stringify(result.metricas));
    console.log("BREAKDOWN FILAS:", JSON.stringify(result.filas));
  });
});
