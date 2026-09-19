import { describe, expect, it } from "vitest";
import { isYapeEmail, parseYapeEmail } from "./yape";
import { isBcpEmail, parseBcpEmail } from "./bcp";
import { identifyProvider, parseProviderEmail, providerForSender } from "./providers";

/**
 * Parser de las notificaciones de Yape.
 *
 * El correo de referencia es el real, copiado tal cual. Las variantes prueban lo
 * que de verdad se rompe: que Gmail entregue el texto con otra separación, que
 * falte un campo, o que llegue un correo que NO es una operación.
 */

/** El correo tal como llega. */
const YAPE_EMAIL = `
¡Acabas de yapear exitosamente!

Monto de yapeo

S/ 55.00

Yapero
Joseph Gue*

Fecha y Hora de la operación
14 septiembre 2026 - 07:38 a. m.

Celular del Beneficiario
XXXXXXXXX631

Nombre del Beneficiario
Jafeth Ore*

N° de operación
3229173
`;

describe("reconocer un correo de Yape", () => {
  it("reconoce la notificación de yapeo", () => {
    expect(isYapeEmail(YAPE_EMAIL)).toBe(true);
  });

  it("no reclama un correo del BCP", () => {
    // Es la garantía de que ampliar la búsqueda no mezcla proveedores.
    const bcp = `
      Realizaste un consumo de *S/ 35.90* con tu *Tarjeta de Crédito BCP*.
      Total del consumo *S/ 35.90*
      Fecha y hora *28 de agosto de 2026 - 11:20 PM*
      Número de operación *0000414074*
    `;

    expect(isYapeEmail(bcp)).toBe(false);
    expect(isBcpEmail(bcp)).toBe(true);
  });

  it("no reclama un correo promocional de Yape", () => {
    const promo = `
      ¡Gana premios con Yape!
      Participa en nuestro sorteo mensual y llévate S/ 1,000.
      Términos y condiciones en yape.pe
    `;

    expect(isYapeEmail(promo)).toBe(false);
  });

  it("un cuerpo vacío no es un yapeo", () => {
    expect(isYapeEmail("")).toBe(false);
    expect(isYapeEmail("   ")).toBe(false);
  });
});

describe("extraer los datos del yapeo", () => {
  it("lee todos los campos del correo de referencia", () => {
    const result = parseYapeEmail(YAPE_EMAIL);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toMatchObject({
      bank: "YAPE",
      operationType: "Yape enviado",
      // 07:38 de la mañana en hora de Lima, no UTC.
      transactionAt: "2026-09-14T07:38:00-05:00",
      amount: 55,
      currency: "PEN",
      merchant: "Jafeth Ore*",
      cardLast4: null,
      operationNumber: "3229173",
      source: "GMAIL_YAPE",
    });
  });

  it("el comentario dice a quién se le yapeó", () => {
    const result = parseYapeEmail(YAPE_EMAIL);

    expect(result.ok && result.data.comment).toBe("Yape a Jafeth Ore* · XXXXXXXXX631");
  });

  it("no guarda al yapero: sería la misma persona en todas las filas", () => {
    const result = parseYapeEmail(YAPE_EMAIL);
    const serializado = JSON.stringify(result);

    expect(serializado).not.toContain("Joseph");
  });

  it("interpreta la tarde correctamente", () => {
    const tarde = YAPE_EMAIL.replace("07:38 a. m.", "07:38 p. m.");

    expect(parseYapeEmail(tarde)).toMatchObject({
      ok: true,
      data: { transactionAt: "2026-09-14T19:38:00-05:00" },
    });
  });

  it("acepta importes con separador de millar", () => {
    const grande = YAPE_EMAIL.replace("S/ 55.00", "S/ 1,250.50");

    expect(parseYapeEmail(grande)).toMatchObject({
      ok: true,
      data: { amount: 1250.5 },
    });
  });

  it("tolera que el valor venga en la misma línea", () => {
    // Otra conversión HTML→texto puede pegar etiqueta y valor.
    const pegado = `
      ¡Acabas de yapear exitosamente!
      Monto de yapeo: S/ 80.00
      Fecha y Hora de la operación: 02 octubre 2026 - 03:05 p. m.
      Nombre del Beneficiario: Ana Tor*
      N° de operación: 9911223
    `;

    expect(parseYapeEmail(pegado)).toMatchObject({
      ok: true,
      data: {
        amount: 80,
        transactionAt: "2026-10-02T15:05:00-05:00",
        merchant: "Ana Tor*",
        operationNumber: "9911223",
      },
    });
  });

  it("lee el beneficiario cuando Gmail apelmaza el bloque en un párrafo", () => {
    // Correo real: Gmail convirtió «Yapero ... Nº de operación NNNNN» en UNA
    // sola línea, sin saltos entre etiquetas. `findValueByLabel` —que mira el
    // inicio de cada línea— no ve nada ahí; esto ejercita el respaldo
    // `matchInline` que sí encuentra el valor anclado a la etiqueta siguiente.
    const apelmazado = `
¡Hola, Joseph Gue*!

¡Acabas de yapear exitosamente!

Monto de yapeo

S/ 68.00

Yapero Joseph Gue* Tu número de celular XXXXXXXXX216 Fecha y Hora de la operación 14 septiembre 2026 - 07:27 p. m. Celular del Beneficiario XXXXXXXXX399 Nombre del Beneficiario David Pad* Nº de operación 28151888
`;

    const result = parseYapeEmail(apelmazado);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toMatchObject({
      amount: 68,
      transactionAt: "2026-09-14T19:27:00-05:00",
      merchant: "David Pad*",
      operationNumber: "28151888",
      comment: "Yape a David Pad* · XXXXXXXXX399",
    });

    // El yapero («Joseph Gue*», el propio dueño de la cuenta) nunca se guarda,
    // ni siquiera en este formato donde aparece pegado al principio del bloque.
    expect(JSON.stringify(result)).not.toContain("Joseph Gue");
  });

  it("no confunde el celular DEL YAPERO con el del beneficiario", () => {
    // El párrafo trae DOS números enmascarados: «Tu número de celular
    // XXXXXXXXX216» (el tuyo) y «Celular del Beneficiario XXXXXXXXX399» (el
    // suyo). Solo el segundo debe acabar en el comentario.
    const apelmazado = `
Monto de yapeo

S/ 10.00

Yapero Joseph Gue* Tu número de celular XXXXXXXXX216 Fecha y Hora de la operación 1 enero 2027 - 09:00 a. m. Celular del Beneficiario XXXXXXXXX777 Nombre del Beneficiario Luis Cas* Nº de operación 1234567
`;

    const result = parseYapeEmail(apelmazado);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.comment).toContain("XXXXXXXXX777");
    expect(result.data.comment).not.toContain("XXXXXXXXX216");
  });
});

describe("correos de Yape incompletos", () => {
  it("sin importe no se registra nada", () => {
    const sinMonto = YAPE_EMAIL.replace("S/ 55.00", "");
    const result = parseYapeEmail(sinMonto);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("MISSING_FIELDS");
    expect(result.error.missingFields).toContain("amount");
  });

  it("sin número de operación no se registra nada", () => {
    const sinNumero = YAPE_EMAIL.replace("3229173", "");
    const result = parseYapeEmail(sinNumero);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.missingFields).toContain("operationNumber");
  });

  it("SIN beneficiario sí se registra: el gasto existe igual", () => {
    // Perder un movimiento real por un campo decorativo sería peor que
    // registrarlo con un nombre genérico que el usuario puede corregir.
    const sinNombre = YAPE_EMAIL.replace("Nombre del Beneficiario\nJafeth Ore*", "");
    const result = parseYapeEmail(sinNombre);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.amount).toBe(55);
    expect(result.data.merchant).toBe("Yape");
  });

  it("un celular con formato inesperado no se copia", () => {
    // Si Yape dejara de enmascararlo, no queremos guardar el número entero.
    const completo = YAPE_EMAIL.replace("XXXXXXXXX631", "987654321");
    const result = parseYapeEmail(completo);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.comment).toBe("Yape a Jafeth Ore*");
    expect(JSON.stringify(result)).not.toContain("987654321");
  });

  it("un correo que no es de Yape se rechaza sin inventar datos", () => {
    const result = parseYapeEmail("Hola, esto no es una notificación.");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_A_MATCH");
  });
});

describe("identificar el proveedor", () => {
  const BCP_EMAIL = `
    Realizaste un consumo de *S/ 35.90* con tu *Tarjeta de Crédito BCP* en *PLAZA VEA*.
    Total del consumo *S/ 35.90*
    Operación realizada *Consumo Tarjeta de Crédito*
    Fecha y hora *28 de agosto de 2026 - 11:20 PM*
    Número de operación *0000414074*
  `;

  it("reconoce a cada uno por su remitente", () => {
    expect(providerForSender("notificaciones@yape.pe")?.id).toBe("YAPE");
    expect(providerForSender('"BCP" <notificaciones@notificacionesbcp.com.pe>')?.id).toBe("BCP");
    expect(providerForSender("alguien@gmail.com")).toBeNull();
  });

  it("exige remitente Y contenido", () => {
    // El remitente correcto con contenido de otro tipo no basta: el mismo
    // buzón manda publicidad, y registrarla sería inventar un gasto.
    expect(
      identifyProvider({ from: "notificaciones@yape.pe", rawBody: "¡Gana premios con Yape!" }),
    ).toBeNull();

    expect(
      identifyProvider({ from: "notificaciones@yape.pe", rawBody: YAPE_EMAIL })?.id,
    ).toBe("YAPE");
  });

  it("un correo de Yape enviado desde el buzón del BCP no se acepta", () => {
    // Cruzar remitente y contenido es justo lo que hay que impedir al ampliar
    // la búsqueda a dos proveedores.
    expect(
      identifyProvider({
        from: "notificaciones@notificacionesbcp.com.pe",
        rawBody: YAPE_EMAIL,
      }),
    ).toBeNull();
  });

  it("despacha cada correo a su parser", () => {
    const yape = parseProviderEmail({ from: "notificaciones@yape.pe", rawBody: YAPE_EMAIL });
    expect(yape?.provider.id).toBe("YAPE");
    expect(yape?.result.ok && yape.result.data.bank).toBe("YAPE");

    const bcp = parseProviderEmail({
      from: "notificaciones@notificacionesbcp.com.pe",
      rawBody: BCP_EMAIL,
    });
    expect(bcp?.provider.id).toBe("BCP");
    expect(bcp?.result.ok && bcp.result.data.bank).toBe("BCP");
  });

  it("el parser del BCP sigue funcionando exactamente igual", () => {
    // La regresión que más importa: añadir Yape no puede tocar lo que ya iba.
    const result = parseBcpEmail(BCP_EMAIL);

    // No se afirma el comercio: este correo es una reproduccion simplificada y
    // el recorte de asteriscos depende del formato exacto del banco. Eso lo
    // cubre `bcpConsumo.test.ts` con correos reales; aqui lo que importa es que
    // el despacho por proveedor no haya cambiado lo que ya funcionaba.
    expect(result).toMatchObject({
      ok: true,
      data: {
        bank: "BCP",
        amount: 35.9,
        operationNumber: "0000414074",
        source: "GMAIL_BCP",
      },
    });
  });

  it("sin remitente reconoce por contenido", () => {
    // Es el caso de reprocesar un cuerpo suelto desde un script.
    expect(identifyProvider({ rawBody: YAPE_EMAIL })?.id).toBe("YAPE");
    expect(identifyProvider({ rawBody: BCP_EMAIL })?.id).toBe("BCP");
  });
});
