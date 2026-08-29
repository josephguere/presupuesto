import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isBcpConsumoEmail, parseBcpConsumoEmail } from "./bcpConsumo";
import { extractLast4, parseAmount, parseSpanishDateTime } from "./normalize";

/**
 * Construye un correo con la estructura real del BCP, permitiendo alterar una
 * pieza a la vez. Así cada test dice exactamente qué está probando en lugar de
 * repetir veinte líneas de correo.
 */
function buildEmail(
  overrides: {
    total?: string;
    operationType?: string;
    dateTime?: string;
    card?: string;
    merchant?: string;
    operationNumber?: string;
    intro?: string;
  } = {},
): string {
  const {
    total = "S/ 20.00",
    operationType = "Consumo Tarjeta de Débito",
    dateTime = "26 de agosto de 2026 - 06:28 PM",
    card = "************3400",
    merchant = "YAPE",
    operationNumber = "539458",
    intro = `Realizaste un consumo de ${total} con tu\nTarjeta de Débito BCP en ${merchant}.`,
  } = overrides;

  return [
    intro,
    "",
    "Datos de la operación:",
    "",
    "Total del consumo:",
    total,
    "",
    "Operación realizada:",
    operationType,
    "",
    "Fecha y hora:",
    dateTime,
    "",
    "Número de Tarjeta de Débito:",
    card,
    "",
    "Empresa:",
    merchant,
    "",
    "Número de operación:",
    operationNumber,
  ].join("\n");
}

/** Extrae los datos o falla el test con un mensaje útil. */
function parseOrFail(rawBody: string) {
  const result = parseBcpConsumoEmail(rawBody);
  if (!result.ok) {
    throw new Error(`Se esperaba un parseo correcto, pero falló: ${result.error.message}`);
  }
  return result.data;
}

describe("parseBcpConsumoEmail — correo de referencia", () => {
  it("extrae todos los campos del correo real del BCP", () => {
    // CASO 1 · CASO 4 · CASO 5 · CASO 6, todos en el correo de referencia.
    expect(parseOrFail(buildEmail())).toEqual({
      bank: "BCP",
      operationType: "Consumo Tarjeta de Débito",
      transactionAt: "2026-08-26T18:28:00-05:00",
      amount: 20,
      currency: "PEN",
      merchant: "YAPE",
      cardLast4: "3400",
      operationNumber: "539458",
      source: "GMAIL_BCP",
    });
  });
});

describe("parseBcpConsumoEmail — formatos de monto", () => {
  // CASO 1, 2 y 3: el mismo dato escrito de cuatro maneras distintas.
  const cases: Array<[string, number]> = [
    ["S/ 20.00", 20],
    ["S/ 20,00", 20],
    ["S/ 1,250.50", 1250.5],
    ["S/ 1.250,50", 1250.5],
    ["S/. 20.00", 20],
    ["S/ 1,250", 1250],
    ["S/ 999,999.99", 999999.99],
  ];

  it.each(cases)("interpreta %s como %d", (total, expected) => {
    const transaction = parseOrFail(buildEmail({ total }));
    expect(transaction.amount).toBe(expected);
    expect(transaction.currency).toBe("PEN");
  });

  it("detecta dólares cuando el correo llega en US$", () => {
    const transaction = parseOrFail(buildEmail({ total: "US$ 30.50" }));
    expect(transaction.amount).toBe(30.5);
    expect(transaction.currency).toBe("USD");
  });
});

describe("parseBcpConsumoEmail — empresa", () => {
  // CASO 4
  it("lee la empresa de la etiqueta Empresa", () => {
    expect(parseOrFail(buildEmail()).merchant).toBe("YAPE");
  });

  it("conserva nombres de comercio con espacios y símbolos", () => {
    const transaction = parseOrFail(buildEmail({ merchant: "PLAZA VEA - SURCO" }));
    expect(transaction.merchant).toBe("PLAZA VEA - SURCO");
  });

  it("recupera la empresa de la frase de apertura si falta la etiqueta", () => {
    const withoutLabel = buildEmail()
      .replace("Empresa:\nYAPE", "")
      .replace(/\n{3,}/g, "\n\n");
    expect(parseOrFail(withoutLabel).merchant).toBe("YAPE");
  });
});

describe("parseBcpConsumoEmail — tarjeta", () => {
  // CASO 5
  it("extrae los últimos 4 dígitos de una tarjeta enmascarada", () => {
    expect(parseOrFail(buildEmail()).cardLast4).toBe("3400");
  });

  it("acepta otras máscaras habituales", () => {
    expect(parseOrFail(buildEmail({ card: "**** **** **** 3400" })).cardLast4).toBe("3400");
    expect(parseOrFail(buildEmail({ card: "XXXXXXXX3400" })).cardLast4).toBe("3400");
  });

  it("devuelve null si el correo no trae tarjeta, sin romper el resto", () => {
    const withoutCard = buildEmail()
      .replace("Número de Tarjeta de Débito:\n************3400", "")
      .replace(/\n{3,}/g, "\n\n");
    const transaction = parseOrFail(withoutCard);
    expect(transaction.cardLast4).toBeNull();
    expect(transaction.amount).toBe(20);
  });
});

describe("parseBcpConsumoEmail — fecha y hora", () => {
  // CASO 6: la conversión clave del MVP.
  it("convierte 26 de agosto de 2026 - 06:28 PM a hora de Lima", () => {
    expect(parseOrFail(buildEmail()).transactionAt).toBe("2026-08-26T18:28:00-05:00");
  });

  it("el instante resultante equivale a las 23:28 UTC", () => {
    const { transactionAt } = parseOrFail(buildEmail());
    expect(new Date(transactionAt).toISOString()).toBe("2026-08-26T23:28:00.000Z");
  });

  it.each([
    ["26 de agosto de 2026 - 06:28 PM", "2026-08-26T18:28:00-05:00"],
    ["26 de agosto de 2026 - 06:28 p. m.", "2026-08-26T18:28:00-05:00"],
    ["26 de agosto de 2026 - 06:28 AM", "2026-08-26T06:28:00-05:00"],
    ["26 de agosto de 2026 - 18:28", "2026-08-26T18:28:00-05:00"],
    ["1 de enero de 2026 - 12:05 AM", "2026-01-01T00:05:00-05:00"],
    ["1 de enero de 2026 - 12:05 PM", "2026-01-01T12:05:00-05:00"],
    ["3 de setiembre de 2026 - 09:07 PM", "2026-09-03T21:07:00-05:00"],
    ["26 de agosto de 2026 - 06:28:45 PM", "2026-08-26T18:28:45-05:00"],
  ])("interpreta %s", (dateTime, expected) => {
    expect(parseOrFail(buildEmail({ dateTime })).transactionAt).toBe(expected);
  });

  it("nunca asume UTC", () => {
    const { transactionAt } = parseOrFail(buildEmail());
    expect(transactionAt.endsWith("Z")).toBe(false);
    expect(transactionAt.endsWith("-05:00")).toBe(true);
  });
});

describe("parseBcpConsumoEmail — tolerancia del formato", () => {
  it("tolera espacios no separables y caracteres de ancho cero", () => {
    // Lo que deja una conversión HTML→texto: &nbsp; y marcas invisibles.
    const messy = buildEmail()
      .replace(/S\/ 20\.00/g, `S/\u00A020.00`) // espacio no separable
      .replace("YAPE", `\u200BYAPE\u200B`) // ancho cero
      .replace("539458", `539458\uFEFF`); // BOM

    const transaction = parseOrFail(messy);
    expect(transaction.amount).toBe(20);
    expect(transaction.merchant).toBe("YAPE");
    expect(transaction.operationNumber).toBe("539458");
  });

  it("tolera indentación, líneas en blanco de más y saltos CRLF", () => {
    const messy = buildEmail()
      .split("\n")
      .map((line) => `    ${line}   `)
      .join("\r\n\r\n\r\n");

    expect(parseOrFail(messy).amount).toBe(20);
  });

  it("tolera etiquetas sin tildes y en mayúsculas", () => {
    const noAccents = buildEmail()
      .replace("Operación realizada:", "OPERACION REALIZADA:")
      .replace("Número de operación:", "NUMERO DE OPERACION:")
      .replace("Número de Tarjeta de Débito:", "NUMERO DE TARJETA DE DEBITO:");

    const transaction = parseOrFail(noAccents);
    expect(transaction.operationNumber).toBe("539458");
    expect(transaction.cardLast4).toBe("3400");
  });

  it("acepta el valor en la misma línea que la etiqueta", () => {
    const inline = [
      "Realizaste un consumo de S/ 20.00 con tu Tarjeta de Débito BCP en YAPE.",
      "Total del consumo: S/ 20.00",
      "Operación realizada: Consumo Tarjeta de Débito",
      "Fecha y hora: 26 de agosto de 2026 - 06:28 PM",
      "Número de Tarjeta de Débito: ************3400",
      "Empresa: YAPE",
      "Número de operación: 539458",
    ].join("\n");

    expect(parseOrFail(inline).operationNumber).toBe("539458");
    expect(parseOrFail(inline).merchant).toBe("YAPE");
  });

  it("tolera <br> y &nbsp; supervivientes de una conversión HTML floja", () => {
    const htmlish = buildEmail().replace(/\n/g, "<br>").replace(/ /g, "&nbsp;");
    const transaction = parseOrFail(htmlish);
    expect(transaction.amount).toBe(20);
    expect(transaction.transactionAt).toBe("2026-08-26T18:28:00-05:00");
  });
});

describe("parseBcpConsumoEmail — errores controlados", () => {
  // CASO 7: nada de esto debe reventar la aplicación.
  it("rechaza un correo que no es del BCP", () => {
    const result = parseBcpConsumoEmail("Hola, tu factura de luz ya está disponible.");
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_A_MATCH" } });
  });

  it("rechaza un cuerpo vacío", () => {
    expect(parseBcpConsumoEmail("")).toMatchObject({ ok: false });
    expect(parseBcpConsumoEmail("   \n  \n ")).toMatchObject({ ok: false });
  });

  it("informa qué campos obligatorios faltan", () => {
    const truncated = "Realizaste un consumo de S/ 20.00 con tu Tarjeta de Débito BCP.";
    const result = parseBcpConsumoEmail(truncated);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MISSING_FIELDS");
    expect(result.error.missingFields).toEqual(
      expect.arrayContaining(["transactionAt", "operationNumber"]),
    );
  });

  it("no lanza nunca, ni con basura ni con entradas absurdas", () => {
    const garbage = [
      "",
      "  ",
      "Realizaste un consumo",
      "<html><body><table><tr><td></td></tr></table></body></html>",
      "Realizaste un consumo de S/ con tu tarjeta",
      "x".repeat(200_000),
      JSON.stringify({ inesperado: true }),
    ];

    for (const input of garbage) {
      expect(() => parseBcpConsumoEmail(input)).not.toThrow();
      expect(parseBcpConsumoEmail(input).ok).toBe(false);
    }
  });

  it("rechaza montos y fechas imposibles en lugar de inventarlos", () => {
    expect(parseBcpConsumoEmail(buildEmail({ total: "S/ 0.00" })).ok).toBe(false);
    expect(parseBcpConsumoEmail(buildEmail({ dateTime: "31 de febrero de 2026 - 06:28 PM" })).ok).toBe(
      false,
    );
    expect(parseBcpConsumoEmail(buildEmail({ dateTime: "26 de agosto de 2026 - 13:28 PM" })).ok).toBe(
      false,
    );
  });
});

describe("isBcpConsumoEmail", () => {
  it("reconoce la frase con y sin tildes o mayúsculas", () => {
    expect(isBcpConsumoEmail("Realizaste un consumo de S/ 20.00")).toBe(true);
    expect(isBcpConsumoEmail("REALIZASTE UN CONSUMO")).toBe(true);
    expect(isBcpConsumoEmail("Se realizó un abono en tu cuenta")).toBe(false);
  });
});

describe("parseBcpConsumoEmail - formato real del BCP", () => {
  // Disposicion que usa el banco de verdad: etiqueta y valor en el mismo
  // renglon, SIN dos puntos, con el valor en negrita (asteriscos en texto plano).
  // Este bloque nace de un correo real que la version anterior no supo leer.
  const realEmail = readFileSync(
    resolve(process.cwd(), "samples/bcp-consumo-credito.txt"),
    "utf8",
  );

  it("extrae todos los campos sin un solo dos puntos en el correo", () => {
    expect(parseOrFail(realEmail)).toEqual({
      bank: "BCP",
      operationType: "Consumo Tarjeta de Crédito",
      transactionAt: "2026-08-28T23:20:00-05:00",
      amount: 35.9,
      currency: "PEN",
      merchant: "DLC*helphbomaxcom",
      cardLast4: "2437",
      operationNumber: "0000414074",
      source: "GMAIL_BCP",
    });
  });

  it("conserva los asteriscos internos del nombre del comercio", () => {
    // Solo se quita el par EXTERIOR del enfasis: "DLC*helphbomaxcom" es el
    // nombre real del comercio y perder ese asterisco cambiaria el dato.
    expect(parseOrFail(realEmail).merchant).toBe("DLC*helphbomaxcom");
  });

  it("conserva los ceros a la izquierda del numero de operacion", () => {
    // La columna es TEXT justamente por esto.
    expect(parseOrFail(realEmail).operationNumber).toBe("0000414074");
  });

  it("lee la tarjeta de credito, no solo la de debito", () => {
    expect(parseOrFail(realEmail).cardLast4).toBe("2437");
  });

  it("11:20 PM se convierte a 23:20 hora de Lima", () => {
    expect(parseOrFail(realEmail).transactionAt).toBe("2026-08-28T23:20:00-05:00");
  });

  it("no se deja confundir por el texto legal que menciona tarjetas", () => {
    // El pie del correo habla de "numero de tu tarjeta de debito o credito".
    // Ese parrafo no debe robarle el valor a la etiqueta real.
    expect(parseOrFail(realEmail).cardLast4).toBe("2437");
  });

  it("encuentra el numero de operacion aunque falte la etiqueta exacta", () => {
    // Respaldo: el campo que rompio la ingesta la primera vez.
    const alterado = realEmail.replace(
      "Número de operación *0000414074*",
      "Numero de operacion  0000414074",
    );
    expect(parseOrFail(alterado).operationNumber).toBe("0000414074");
  });
});

describe("regresion: las etiquetas genericas no roban valores", () => {
  it('"Tarjeta" no captura la frase "Tarjeta de Debito BCP en YAPE"', () => {
    // Bug real: la etiqueta generica casaba con la frase de apertura y
    // devolvia "BCP en YAPE." en lugar de los cuatro digitos.
    expect(parseOrFail(buildEmail()).cardLast4).toBe("3400");
  });

  it("una etiqueta seguida de un simple espacio no cuenta como etiqueta", () => {
    // Solo valen ":", fin de linea o valor en negrita. Si bastara un espacio,
    // volveria el bug de arriba.
    const ambiguo = ["Realizaste un consumo", "Tarjeta de Debito BCP en YAPE"].join("\n");
    expect(parseBcpConsumoEmail(ambiguo).ok).toBe(false);
  });
});

describe("helpers de normalización", () => {
  it("parseAmount distingue millares de decimales", () => {
    expect(parseAmount("S/ 1,250")).toMatchObject({ amount: 1250 });
    expect(parseAmount("S/ 1.250")).toMatchObject({ amount: 1250 });
    expect(parseAmount("S/ 20,5")).toMatchObject({ amount: 20.5 });
    expect(parseAmount("S/ 1,234,567.89")).toMatchObject({ amount: 1234567.89 });
    expect(parseAmount("S/ -5.00")).toBeNull();
    expect(parseAmount("sin número")).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });

  it("parseSpanishDateTime devuelve null ante entradas inválidas", () => {
    expect(parseSpanishDateTime("ayer por la tarde")).toBeNull();
    expect(parseSpanishDateTime("26 de agostoo de 2026 - 06:28 PM")).toBeNull();
    expect(parseSpanishDateTime("")).toBeNull();
  });

  it("extractLast4 solo devuelve grupos completos de 4 dígitos", () => {
    expect(extractLast4("************3400")).toBe("3400");
    expect(extractLast4("123")).toBeNull();
    expect(extractLast4(null)).toBeNull();
  });
});
