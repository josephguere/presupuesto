import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isBcpPagoServicioEmail, parseBcpPagoServicioEmail } from "./bcpPagoServicio";

/**
 * Constancias de pago de servicios.
 *
 * Las muestras reproducen la maquetación REAL del banco: media docena de campos
 * apelotonados en un solo renglón, valores en negrita y huecos escritos `**`.
 * Es justo lo que rompía la primera versión de este parser, que daba por hecha
 * una tabla con un campo por línea.
 */

function sample(name: string): string {
  return readFileSync(resolve(process.cwd(), "samples", name), "utf8");
}

const LUZ = sample("bcp-pago-servicio.txt");
const MOVIL = sample("bcp-pago-servicio-entel.txt");

function parse(body: string) {
  const result = parseBcpPagoServicioEmail(body);
  if (!result.ok) throw new Error(`No se pudo parsear: ${result.error.message}`);
  return result.data;
}

describe("reconocimiento", () => {
  it("reconoce un pago de servicios", () => {
    expect(isBcpPagoServicioEmail(LUZ)).toBe(true);
    expect(isBcpPagoServicioEmail(MOVIL)).toBe(true);
  });

  it("no reclama correos de otro tipo", () => {
    expect(isBcpPagoServicioEmail(sample("bcp-transferencia.txt"))).toBe(false);
    expect(isBcpPagoServicioEmail(sample("bcp-consumo.txt"))).toBe(false);
  });

  it("un cuerpo vacío no es un pago", () => {
    expect(isBcpPagoServicioEmail("")).toBe(false);
    expect(parseBcpPagoServicioEmail("").ok).toBe(false);
  });
});

describe("campos del recibo de luz", () => {
  const data = parse(LUZ);

  it("la empresa va en Movimiento", () => expect(data.merchant).toBe("ELECTRO UCAYALI"));
  it("el importe es el monto total", () => expect(data.amount).toBe(174.2));
  it("en soles", () => expect(data.currency).toBe("PEN"));
  it("el tipo lo dice el banco", () => expect(data.operationType).toBe("Pago de servicios"));
  it("número de operación", () => expect(data.operationNumber).toBe("01208745"));

  it("la tarjeta sale del renglón bajo «Cuenta de origen»", () => {
    // El valor de esa etiqueta es «Tarjeta de crédito»; el número está debajo.
    expect(data.cardLast4).toBe("2437");
  });

  it("la fecha sin «de», con día de la semana delante", () => {
    // `Jueves, 03 Septiembre 2026 - 10:18 A. M.`
    expect(data.transactionAt).toBe("2026-09-03T10:18:00-05:00");
  });
});

describe("campos que están en medio de un renglón", () => {
  it("lee Empresa aunque venga tras otro campo", () => {
    // `Fecha y hora: *...* Empresa: *ELECTRO UCAYALI* Servicio: *CONSUMO* ...`
    expect(LUZ).toContain("Empresa: *ELECTRO UCAYALI*");
    expect(parse(LUZ).merchant).toBe("ELECTRO UCAYALI");
  });

  it("«Servicio» no se confunde con «Titular del servicio»", () => {
    // Están en el mismo renglón y el titular es OTRA persona. Confundirlos
    // metería un nombre ajeno en el comentario.
    expect(LUZ).toContain("Titular del servicio: *OTRO NOMBRE , APELLIDO*");
    expect(parse(LUZ).comment).toBe("CONSUMO · 148375");
    expect(parse(LUZ).comment).not.toContain("OTRO NOMBRE");
  });

  it("un valor vacío (`**`) se trata como ausente", () => {
    // El correo trae `Comisión: **`, `Vigencia: **`, `IGV: **`...
    expect(LUZ).toContain("Comisión: **");
    expect(parse(LUZ).amount).toBe(174.2);
  });
});

describe("el comentario distingue recibos de la misma empresa", () => {
  it("guarda servicio y código de usuario", () => {
    expect(parse(MOVIL).comment).toBe("PAGO CON NUMERO TELEFONO · 900000001");
    expect(parse(LUZ).comment).toBe("CONSUMO · 148375");
  });

  it("dos pagos a la misma compañía solo se distinguen por ahí", () => {
    const otro = MOVIL.replace("900000001", "900000002")
      .replace("01236185", "01236871")
      .replace("S/ 74.90", "S/ 59.90");

    const a = parse(MOVIL);
    const b = parse(otro);

    expect(a.merchant).toBe(b.merchant);
    expect(a.comment).not.toBe(b.comment);
    expect(a.operationNumber).not.toBe(b.operationNumber);
  });
});

describe("el importe es el total, no el del recibo suelto", () => {
  it("no confunde «Monto total» con el «Importe» del bloque Nº 1", () => {
    // El correo ya trae huecos para Nº 2, Nº 3 y Nº 4. Al pagar varios recibos
    // de una vez, leer «Importe» daría solo el primero.
    const variosRecibos = LUZ.replace("Monto total: *S/ 174.20*", "Monto total: *S/ 200.00*");

    expect(variosRecibos).toContain("Importe: *S/ 174.20*");
    expect(parse(variosRecibos).amount).toBe(200);
  });
});

describe("correo incompleto", () => {
  it("sin monto total no inventa un importe", () => {
    const roto = LUZ.replace("Monto total: *S/ 174.20*", "Monto total: **");
    const result = parseBcpPagoServicioEmail(roto);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MISSING_FIELDS");
    expect(result.error.missingFields).toContain("amount");
  });

  it("sin fecha tampoco", () => {
    const roto = LUZ.replace("Jueves, 03 Septiembre 2026 - 10:18 A. M.", "");
    const result = parseBcpPagoServicioEmail(roto);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.missingFields).toContain("transactionAt");
  });

  it("sin cuenta de origen deja la tarjeta vacía en vez de adivinarla", () => {
    const roto = LUZ.replace("Cuenta de origen: *Tarjeta de crédito", "Cuenta de origen: *");
    expect(parse(roto).cardLast4).toBeNull();
  });
});
