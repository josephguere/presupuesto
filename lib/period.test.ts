import { describe, expect, it } from "vitest";
import {
  addDays,
  daysInMonth,
  formatDay,
  formatRangeLabel,
  getLimaToday,
  isRealDate,
  previousPeriod,
  resolvePeriod,
  toTransactionFilters,
  type PeriodSpec,
} from "./period";

/**
 * Resolución de períodos en hora de Lima.
 *
 * TODOS los instantes se inyectan por parámetro. Ni un `vi.useFakeTimers`, ni un
 * `vi.setSystemTime`, ni un `new Date()` sin argumentos: el módulo es puro, así
 * que esta suite da el mismo resultado hoy y dentro de tres años. Una prueba de
 * fechas que depende del reloj es una prueba que fallará un día cualquiera sin
 * que nadie haya tocado nada.
 */

/** 23:30 del VIERNES 4 de septiembre de 2026 en Lima (04:30 UTC del sábado). */
const NOCHE_DEL_VIERNES = new Date("2026-09-05T04:30:00Z");

/** 00:00 del SÁBADO 5 de septiembre de 2026 en Lima. */
const MADRUGADA_DEL_SABADO = new Date("2026-09-05T05:00:00Z");

describe("qué día es hoy en Lima", () => {
  it("no se adelanta cuando en UTC ya es mañana", () => {
    // El caso que rompe si alguien usa `new Date().toISOString().slice(0, 10)`:
    // a las 23:30 de Lima, en UTC ya es el día siguiente.
    expect(getLimaToday(NOCHE_DEL_VIERNES)).toBe("2026-09-04");
    expect(getLimaToday(MADRUGADA_DEL_SABADO)).toBe("2026-09-05");
  });
});

describe("períodos relativos", () => {
  it("hoy y ayer", () => {
    expect(resolvePeriod({ kind: "hoy" }, MADRUGADA_DEL_SABADO)).toMatchObject({
      from: "2026-09-05",
      to: "2026-09-05",
    });

    expect(resolvePeriod({ kind: "ayer" }, MADRUGADA_DEL_SABADO)).toMatchObject({
      from: "2026-09-04",
      to: "2026-09-04",
    });
  });

  it("la semana empieza en lunes", () => {
    // El sábado 5 pertenece a la semana que empezó el lunes 31 de agosto.
    expect(resolvePeriod({ kind: "esta_semana" }, MADRUGADA_DEL_SABADO)).toMatchObject({
      from: "2026-08-31",
      to: "2026-09-05",
    });

    expect(resolvePeriod({ kind: "semana_anterior" }, MADRUGADA_DEL_SABADO)).toMatchObject({
      from: "2026-08-24",
      to: "2026-08-30",
    });
  });

  it("un domingo sigue perteneciendo a la semana que empezó el lunes", () => {
    // Domingo 6 de septiembre. Con `getDay()` valiendo 0, un cálculo ingenuo lo
    // metería en la semana siguiente.
    const domingo = new Date("2026-09-06T17:00:00Z");

    expect(resolvePeriod({ kind: "esta_semana" }, domingo)).toMatchObject({
      from: "2026-08-31",
    });
  });

  it("el mes en curso se corta HOY, no el día 30", () => {
    // Decir «del 1 al 30 de septiembre» un día 5 sugeriría que se miraron días
    // que todavía no existen.
    const period = resolvePeriod({ kind: "este_mes" }, MADRUGADA_DEL_SABADO);

    expect(period).toMatchObject({ from: "2026-09-01", to: "2026-09-05" });
    expect(period.label).toContain("mes en curso");
  });

  it("el mes anterior entra entero", () => {
    expect(resolvePeriod({ kind: "mes_anterior" }, MADRUGADA_DEL_SABADO)).toMatchObject({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("el mes anterior a enero es diciembre del año pasado", () => {
    const enero = new Date("2026-01-10T17:00:00Z");

    expect(resolvePeriod({ kind: "mes_anterior" }, enero)).toMatchObject({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("«últimos 30 días» son treinta, contando hoy", () => {
    const period = resolvePeriod({ kind: "ultimos_dias", days: 30 }, MADRUGADA_DEL_SABADO);

    expect(period).toMatchObject({ from: "2026-08-07", to: "2026-09-05" });
  });

  it("«todo» no pone extremos", () => {
    const period = resolvePeriod({ kind: "todo" }, MADRUGADA_DEL_SABADO);

    expect(period.from).toBeUndefined();
    expect(period.to).toBeUndefined();
    expect(toTransactionFilters(period)).toEqual({});
  });
});

describe("meses con nombre", () => {
  it("«agosto» sin año es el agosto que ya pasó", () => {
    expect(resolvePeriod({ kind: "mes", month: 8 }, MADRUGADA_DEL_SABADO)).toMatchObject({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("un mes que aún no ha llegado es el del año pasado", () => {
    // En septiembre de 2026, «diciembre» solo puede ser el de 2025.
    expect(resolvePeriod({ kind: "mes", month: 12 }, MADRUGADA_DEL_SABADO)).toMatchObject({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("con año explícito manda el año", () => {
    expect(
      resolvePeriod({ kind: "mes", month: 12, year: 2026 }, MADRUGADA_DEL_SABADO),
    ).toMatchObject({ from: "2026-12-01" });
  });

  it("febrero bisiesto tiene 29 días", () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });
});

describe("rangos explícitos", () => {
  it("un rango invertido se endereza", () => {
    // Es un desliz del modelo, no una pregunta distinta.
    expect(
      resolvePeriod({ kind: "rango", from: "2026-08-30", to: "2026-08-01" }, MADRUGADA_DEL_SABADO),
    ).toMatchObject({ from: "2026-08-01", to: "2026-08-30" });
  });

  it("una fecha imposible degrada al mes en curso en vez de reventar", () => {
    expect(
      resolvePeriod({ kind: "rango", from: "2026-02-31", to: "2026-03-01" }, MADRUGADA_DEL_SABADO),
    ).toMatchObject({ from: "2026-09-01" });
  });

  it("rechaza fechas con forma correcta pero imposibles", () => {
    expect(isRealDate("2026-02-31")).toBe(false);
    expect(isRealDate("2026-13-01")).toBe(false);
    expect(isRealDate("2026-02-28")).toBe(true);
    expect(isRealDate("ayer")).toBe(false);
  });
});

describe("períodos futuros", () => {
  it("un mes que aún no ha empezado se marca", () => {
    const period = resolvePeriod(
      { kind: "rango", from: "2027-01-01", to: "2027-01-31" },
      MADRUGADA_DEL_SABADO,
    );

    expect(period.isFuture).toBe(true);
  });

  it("un período que empezó ayer NO es futuro aunque acabe después", () => {
    // Tiene movimientos que enseñar: solo importa que haya empezado.
    const period = resolvePeriod(
      { kind: "rango", from: "2026-09-01", to: "2026-12-31" },
      MADRUGADA_DEL_SABADO,
    );

    expect(period.isFuture).toBe(false);
  });
});

describe("período anterior para comparar", () => {
  it("las etiquetas relativas comparan con su hermana", () => {
    expect(previousPeriod({ kind: "este_mes" }, MADRUGADA_DEL_SABADO)).toEqual({
      kind: "mes_anterior",
    });
    expect(previousPeriod({ kind: "esta_semana" }, MADRUGADA_DEL_SABADO)).toEqual({
      kind: "semana_anterior",
    });
  });

  it("un mes con nombre retrocede uno, cruzando el año", () => {
    expect(previousPeriod({ kind: "mes", month: 1, year: 2026 }, MADRUGADA_DEL_SABADO)).toEqual({
      kind: "mes",
      month: 12,
      year: 2025,
    });
  });

  it("un rango compara con la ventana anterior de la misma longitud", () => {
    // Del 10 al 19 son diez días; el anterior es del 31 de agosto al 9.
    expect(
      previousPeriod({ kind: "rango", from: "2026-09-10", to: "2026-09-19" }, MADRUGADA_DEL_SABADO),
    ).toEqual({ kind: "rango", from: "2026-08-31", to: "2026-09-09" });
  });

  it("«todo el historial» no tiene anterior", () => {
    // Es lo que hace que `period_comparison` sobre «todo» se rechace en vez de
    // comparar contra la nada.
    expect(previousPeriod({ kind: "todo" }, MADRUGADA_DEL_SABADO)).toBeNull();
  });
});

describe("aritmética de días", () => {
  it("cruza meses y años sin depender de la zona del proceso", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("etiquetas", () => {
  it("un día suelto se escribe en cristiano", () => {
    expect(formatDay("2026-09-05")).toBe("5 de septiembre de 2026");
  });

  it("dentro del mismo mes no se repite el mes", () => {
    expect(formatRangeLabel("2026-09-01", "2026-09-30")).toBe(
      "del 1 al 30 de septiembre de 2026",
    );
  });

  it("entre meses distintos se nombran los dos", () => {
    expect(formatRangeLabel("2026-08-15", "2026-09-05")).toBe(
      "del 15 de agosto de 2026 al 5 de septiembre de 2026",
    );
  });

  it("un solo día no se escribe como rango", () => {
    expect(formatRangeLabel("2026-09-05", "2026-09-05")).toBe("el 5 de septiembre de 2026");
  });

  it("sin extremos, todo el historial", () => {
    expect(formatRangeLabel(undefined, undefined)).toBe("todo el historial");
  });
});

describe("los períodos siempre producen filtros usables", () => {
  it("ninguna de las trece etiquetas devuelve una fecha inválida", () => {
    const specs: PeriodSpec[] = [
      { kind: "hoy" },
      { kind: "ayer" },
      { kind: "esta_semana" },
      { kind: "semana_anterior" },
      { kind: "este_mes" },
      { kind: "mes_anterior" },
      { kind: "este_ano" },
      { kind: "ano_anterior" },
      { kind: "todo" },
      { kind: "ultimos_dias", days: 7 },
      { kind: "mes", month: 3 },
      { kind: "ano", year: 2025 },
      { kind: "rango", from: "2026-01-01", to: "2026-01-31" },
    ];

    for (const spec of specs) {
      const period = resolvePeriod(spec, MADRUGADA_DEL_SABADO);

      expect(period.label.length).toBeGreaterThan(0);
      if (period.from) expect(isRealDate(period.from)).toBe(true);
      if (period.to) expect(isRealDate(period.to)).toBe(true);
      if (period.from && period.to) expect(period.from <= period.to).toBe(true);
    }
  });
});
