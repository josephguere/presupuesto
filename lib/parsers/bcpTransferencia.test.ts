import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isBcpTransferenciaEmail, parseBcpTransferenciaEmail } from "./bcpTransferencia";
import { parseBcpEmail } from "./bcp";

/**
 * Constancias de transferencia.
 *
 * Lo que más importa aquí es cuál de las DOS cuentas del correo acaba guardada.
 */

function sample(name: string): string {
  return readFileSync(resolve(process.cwd(), "samples", name), "utf8");
}

const TRANSFERENCIA = sample("bcp-transferencia.txt");

function parse(body: string) {
  const result = parseBcpTransferenciaEmail(body);
  if (!result.ok) throw new Error(`No se pudo parsear: ${result.error.message}`);
  return result.data;
}

describe("reconocimiento", () => {
  it("reconoce una transferencia", () => {
    expect(isBcpTransferenciaEmail(TRANSFERENCIA)).toBe(true);
  });

  it("no reclama correos de otro tipo", () => {
    expect(isBcpTransferenciaEmail(sample("bcp-pago-servicio.txt"))).toBe(false);
    expect(isBcpTransferenciaEmail(sample("bcp-consumo.txt"))).toBe(false);
  });
});

describe("campos", () => {
  const data = parse(TRANSFERENCIA);

  it("el banco destino va en Movimiento", () =>
    expect(data.merchant).toBe("Transferencia a Interbank"));
  it("el destinatario va al comentario", () =>
    expect(data.comment).toBe("Otro Nombre Apellido S."));
  it("el tipo lo dice el banco", () =>
    expect(data.operationType).toBe("Transferencia a otros bancos"));
  it("número de operación, sin el `<#>` que lo sigue", () =>
    expect(data.operationNumber).toBe("06042517"));
  it("la fecha con «de», en formato de 12 horas", () =>
    expect(data.transactionAt).toBe("2026-09-02T23:11:00-05:00"));
});

describe("la cuenta correcta de las dos que trae el correo", () => {
  it("guarda la de ORIGEN, no la del destinatario", () => {
    // El correo lleva **** 7842 (destinatario) y **** 4035 (tuya). Guardar la
    // primera metería una cuenta ajena en tus movimientos.
    const data = parse(TRANSFERENCIA);

    expect(data.cardLast4).toBe("4035");
    expect(data.cardLast4).not.toBe("7842");
  });

  it("la del destinatario aparece ANTES en el cuerpo, y aun así no gana", () => {
    expect(TRANSFERENCIA.indexOf("7842")).toBeLessThan(TRANSFERENCIA.indexOf("4035"));
    expect(parse(TRANSFERENCIA).cardLast4).toBe("4035");
  });

  it("«desde» de la frase de apertura no cuenta como etiqueta", () => {
    // «Realizaste una transferencia de *S/ 50.00* desde tu *Cuenta corriente*»
    // aparece antes que la fila «Desde *Cuenta corriente*». Sin exigir que la
    // etiqueta lleve su valor pegado en negrita, esa frase gana y el parser
    // acaba leyendo la cuenta del destinatario.
    expect(TRANSFERENCIA).toContain("desde tu *Cuenta corriente.*");
    expect(parse(TRANSFERENCIA).cardLast4).toBe("4035");
  });

  it("sin la fila «Desde» prefiere no poner cuenta a poner la ajena", () => {
    const roto = TRANSFERENCIA.replace("Desde *Cuenta corriente*\n**** 4035\n", "");
    expect(parse(roto).cardLast4).toBeNull();
  });
});

describe("el importe incluye la comisión", () => {
  it("usa «Total cobrado», no «Monto enviado»", () => {
    const conComision = TRANSFERENCIA.replace("Comisión *S/ 0.00*", "Comisión *S/ 3.50*").replace(
      "*Total cobrado* *S/ 50.00*",
      "*Total cobrado* *S/ 53.50*",
    );

    // Lo que sale de la cuenta son 53.50, no los 50.00 que llegan al destino.
    expect(parse(conComision).amount).toBe(53.5);
  });

  it("lee «Total cobrado» aunque la etiqueta venga también en negrita", () => {
    expect(TRANSFERENCIA).toContain("*Total cobrado* *S/ 50.00*");
    expect(parse(TRANSFERENCIA).amount).toBe(50);
  });

  it("si faltara la tabla de montos, lo saca de la frase de apertura", () => {
    const roto = TRANSFERENCIA.replace("Monto enviado *S/ 50.00*", "")
      .replace("*Total cobrado* *S/ 50.00*", "");

    expect(parse(roto).amount).toBe(50);
  });
});

describe("despacho entre parsers", () => {
  it("cada correo va al suyo", () => {
    const casos = [
      ["bcp-consumo.txt", "Consumo Tarjeta de Débito"],
      ["bcp-pago-servicio.txt", "Pago de servicios"],
      ["bcp-transferencia.txt", "Transferencia a otros bancos"],
    ] as const;

    for (const [archivo, tipo] of casos) {
      const result = parseBcpEmail(sample(archivo));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.data.operationType).toBe(tipo);
    }
  });

  it("un correo que no es de ninguno se rechaza sin romper", () => {
    const result = parseBcpEmail("Estimado cliente, su estado de cuenta ya está disponible.");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_A_MATCH");
  });
});
