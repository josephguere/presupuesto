import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pruebas del servicio de tipo de cambio.
 *
 * Se prueba el comportamiento observable: qué número sale y de dónde dice que
 * viene. La caché de Supabase se anula para que cada caso ejercite el camino de
 * la API sin depender de la base de datos.
 */

vi.mock("@/lib/supabase/server", () => ({
  // Sin Supabase, `getUsdToPenRate` salta la caché y va directo a la API.
  isSupabaseConfigured: () => false,
  getSupabaseAdmin: () => {
    throw new Error("no debería usarse");
  },
}));

const { DEFAULT_USD_PEN_RATE, convertUsdToPen, getUsdToPenRate, toRateDate } = await import(
  "./exchangeRate"
);

const FECHA = "2026-08-28T18:20:00-05:00";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Sustituye `fetch` por una respuesta fija. */
function stubFetch(response: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 429,
    json: async () => response,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("getUsdToPenRate — la API responde", () => {
  it("usa el valor de venta de SUNAT", async () => {
    // Venta, no compra: al pagar en dólares el banco te los vende.
    stubFetch({ origen: "SUNAT", compra: 3.34, venta: 3.72, moneda: "USD" });

    const rate = await getUsdToPenRate(FECHA);

    expect(rate).toEqual({ rate: 3.72, source: "API", date: "2026-08-28" });
  });

  it("consulta la fecha de la operación, no la de hoy", async () => {
    const fetchMock = stubFetch({ venta: 3.72 });
    await getUsdToPenRate(FECHA);

    expect(String(fetchMock.mock.calls[0][0])).toContain("fecha=2026-08-28");
  });
});

describe("getUsdToPenRate — fallback", () => {
  it("usa 3.4 cuando la API devuelve un error HTTP", async () => {
    stubFetch({ message: "Too Many Requests" }, false);

    const rate = await getUsdToPenRate(FECHA);

    expect(rate.rate).toBe(DEFAULT_USD_PEN_RATE);
    expect(rate.rate).toBe(3.4);
    expect(rate.source).toBe("FALLBACK");
  });

  it("usa 3.4 cuando la red falla", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const rate = await getUsdToPenRate(FECHA);

    expect(rate).toMatchObject({ rate: 3.4, source: "FALLBACK" });
  });

  it("usa 3.4 cuando la respuesta trae un valor absurdo", async () => {
    // Un tipo de cambio de 0 o de 900 es un dato corrupto, no una noticia.
    for (const venta of [0, -1, 900, null, "tres"]) {
      stubFetch({ venta });
      const rate = await getUsdToPenRate(FECHA);
      expect(rate.source).toBe("FALLBACK");
    }
  });

  it("deja constancia en el log de que se usó el fallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("caída")));

    await getUsdToPenRate(FECHA);

    expect(warn.mock.calls.flat().join(" ")).toContain("exchangeRate.fallback");
  });
});

describe("convertUsdToPen", () => {
  it("aplica el ejemplo con la API funcionando", () => {
    // 16.25 * 3.72 = 60.45
    expect(convertUsdToPen(16.25, 3.72)).toBe(60.45);
  });

  it("aplica el ejemplo con el fallback", () => {
    // 16.25 * 3.4 = 55.25
    expect(convertUsdToPen(16.25, DEFAULT_USD_PEN_RATE)).toBe(55.25);
  });

  it("redondea siempre a 2 decimales", () => {
    expect(convertUsdToPen(10, 3.333)).toBe(33.33);
    expect(convertUsdToPen(1, 3.335)).toBe(3.34);
    expect(convertUsdToPen(0.01, 3.72)).toBe(0.04);
  });
});

describe("toRateDate", () => {
  it("usa el día en Lima, no el del servidor", () => {
    // 04:20 UTC del 29 es todavía el 28 a las 23:20 en Lima.
    expect(toRateDate("2026-08-29T04:20:00.000Z")).toBe("2026-08-28");
    expect(toRateDate("2026-08-28T23:20:00-05:00")).toBe("2026-08-28");
  });
});
