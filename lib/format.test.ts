import { describe, expect, it } from "vitest";
import { formatCurrency, formatTransactionDate, formatTransactionTime, maskCard } from "./format";

describe("formatTransactionTime", () => {
  // El correo del BCP dice "11:20 PM"; aqui se lee "23:20", sin ambiguedad.
  it("muestra la hora en formato 24 h", () => {
    expect(formatTransactionTime("2026-08-28T23:20:00-05:00")).toBe("23:20");
  });

  it.each([
    ["2026-08-28T23:20:00-05:00", "23:20"],
    ["2026-08-26T18:28:00-05:00", "18:28"],
    ["2026-08-26T06:28:00-05:00", "06:28"],
    ["2026-01-01T00:05:00-05:00", "00:05"],
    ["2026-01-01T12:00:00-05:00", "12:00"],
  ])("%s se muestra como %s", (iso, expected) => {
    expect(formatTransactionTime(iso)).toBe(expected);
  });

  it("nunca usa meridiano", () => {
    const rendered = formatTransactionTime("2026-08-28T23:20:00-05:00");
    expect(rendered).not.toMatch(/[ap]\.?\s*m/i);
  });

  it("medianoche es 00:xx, no 24:xx", () => {
    expect(formatTransactionTime("2026-01-01T00:05:00-05:00")).toBe("00:05");
  });

  it("usa la hora de Lima, no la del servidor", () => {
    // 04:20 UTC del dia 29 es todavia el dia 28 a las 23:20 en Lima.
    expect(formatTransactionTime("2026-08-29T04:20:00.000Z")).toBe("23:20");
    expect(formatTransactionDate("2026-08-29T04:20:00.000Z")).toBe("28 Ago 2026");
  });

  it("tolera fechas ausentes o invalidas", () => {
    expect(formatTransactionTime(null)).toBe("");
    expect(formatTransactionTime("no es una fecha")).toBe("");
  });
});

describe("formatCurrency", () => {
  /**
   * `Intl` separa el símbolo con un espacio NO SEPARABLE (U+00A0), para que el
   * importe nunca se parta al final de una línea. Se normaliza para comparar.
   */
  const plainSpaces = (value: string) => value.replace(/\u00A0/g, " ");

  it("usa un espacio no separable tras el símbolo", () => {
    expect(formatCurrency(20)).toContain("\u00A0");
  });

  it("da el formato peruano", () => {
    expect(plainSpaces(formatCurrency(20))).toBe("S/ 20.00");
    expect(plainSpaces(formatCurrency(1250.5))).toBe("S/ 1,250.50");
    expect(plainSpaces(formatCurrency(35.9))).toBe("S/ 35.90");
  });
});

describe("maskCard", () => {
  it("enmascara la tarjeta", () => {
    expect(maskCard("2437")).toBe("****2437");
    expect(maskCard(null)).toBe("—");
  });
});
