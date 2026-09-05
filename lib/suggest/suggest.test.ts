import { describe, expect, it } from "vitest";
import { merchantFamilyKey, normalizeMerchant } from "./merchant";
import { pickFromHistory, type HistoryRow } from "./history";
import { redactComment, redactMerchant } from "./redact";
import { matchCatalogue } from "./gemini";

/**
 * Sugerencia de categoría.
 *
 * Los casos salen de los movimientos REALES del usuario, no de ejemplos
 * inventados: seis variantes de PedidosYa, prefijos de pasarela, códigos de
 * local y dos comercios genuinamente ambiguos.
 */

describe("normalización del comercio", () => {
  it("quita el prefijo de la pasarela de pago", () => {
    expect(normalizeMerchant("DLC*PEDIDOSYA FOOD")).toBe("PEDIDOSYA FOOD");
    expect(normalizeMerchant("EBN*SPOTIFY")).toBe("SPOTIFY");
    expect(normalizeMerchant("IZI*POPCHA")).toBe("POPCHA");
  });

  it("no confunde una marca con una pasarela", () => {
    // «PEDIDOSYA» mide más de cuatro y no está en la lista: se conserva.
    expect(normalizeMerchant("PedidosYa*Plus")).toBe("PEDIDOSYA PLUS");
  });

  it("quita el código de local pero no un número que es parte del nombre", () => {
    // Dos o más dígitos son ruido de sucursal; uno solo puede ser la marca.
    expect(normalizeMerchant("359 MAKRO SANTA ANITA")).toBe("MAKRO SANTA ANITA");
    expect(normalizeMerchant("7 SOPAS SANTA ANITA")).toBe("7 SOPAS SANTA ANITA");
  });

  it("mayúsculas, sin tildes y sin símbolos", () => {
    expect(normalizeMerchant("Café  del  Perú")).toBe("CAFE DEL PERU");
    expect(normalizeMerchant("  DLC*helphbomaxcom ")).toBe("HELPHBOMAXCOM");
  });

  it("ignora los prefijos genéricos", () => {
    for (const raw of ["PAGO NETFLIX", "COMPRA NETFLIX", "CONSUMO NETFLIX"]) {
      expect(normalizeMerchant(raw)).toBe("NETFLIX");
    }
  });

  it("quita la terminación societaria", () => {
    expect(normalizeMerchant("ENTEL PERU S.A.")).toBe("ENTEL PERU");
  });

  it("un comercio vacío no rompe nada", () => {
    expect(normalizeMerchant(null)).toBe("");
    expect(normalizeMerchant("***")).toBe("");
  });
});

describe("familia de marca", () => {
  it("las seis variantes de PedidosYa son una sola familia", () => {
    const variantes = [
      "DLC*PEDIDOSYA FOOD",
      "DLC*PedidosYa Propina",
      "DLC*PedidosYa KFC Qhatu P",
      "DLC*PedidosYa Pizza Hut R",
      "DLC*PedidosYa Chinawok Re",
      "DLC*PedidosYa Donde Walte",
    ];

    expect(new Set(variantes.map(merchantFamilyKey))).toEqual(new Set(["PEDIDOSYA"]));
  });

  it("la pasarela NUNCA agrupa", () => {
    // Es el error clásico: DLC* es el procesador de pago, no el negocio.
    expect(merchantFamilyKey("DLC*Temucom")).not.toBe(merchantFamilyKey("DLC*UBER RIDES"));
  });

  it("no inventa familia cuando no hay marca reconocible", () => {
    // Preferimos no agrupar a agrupar mal.
    expect(merchantFamilyKey("CI SEDE LIMA")).toBe("");
    expect(merchantFamilyKey("359 12 99")).toBe("");
  });

  it("el plural no crea una marca distinta", () => {
    expect(merchantFamilyKey("PEAJES CASETA P6")).toBe(merchantFamilyKey("PEAJE CASETA P10"));
  });
});

describe("decisión por historial", () => {
  /** Historial de prueba, con los repartos reales del usuario. */
  const history: HistoryRow[] = [
    ...repeat({ merchant: "DLC*PEDIDOSYA FOOD", category: "Delivery" }, 4),
    ...repeat({ merchant: "DLC*PedidosYa Propina", category: "Delivery" }, 3),
    ...repeat({ merchant: "ENTEL PERU S.A.", category: "Servicios" }, 3),
    // YAPE: 9 + 2 + 1 + 1 = 13 movimientos, la mayor al 69 %.
    ...repeat({ merchant: "YAPE", category: "Otros" }, 9),
    ...repeat({ merchant: "YAPE", category: "Supermercado" }, 2),
    ...repeat({ merchant: "YAPE", category: "Movilidad Taxi" }, 1),
    ...repeat({ merchant: "YAPE", category: "Transporte" }, 1),
    // Empate limpio.
    { merchant: "723 SPSA PVEA PURUCHUCO", category: "Supermercado" },
    { merchant: "723 SPSA PVEA PURUCHUCO", category: "Café y snacks" },
  ];

  it("el mismo comercio repetido decide", () => {
    expect(pickFromHistory("ENTEL PERU S.A.", history)).toMatchObject({
      category: "Servicios",
      level: "exacto",
      matches: 3,
    });
  });

  it("una variante nueva se resuelve por la familia", () => {
    // «DLC*PedidosYa Bembos» no está en el historial, pero su familia sí.
    expect(pickFromHistory("DLC*PedidosYa Bembos", history)).toMatchObject({
      category: "Delivery",
      level: "familia",
    });
  });

  it("un reparto por debajo del 80 % NO decide", () => {
    // YAPE está al 69 %: es un monedero, no un negocio. Debe ir a Gemini.
    expect(pickFromHistory("YAPE", history)).toBeNull();
  });

  it("un empate tampoco decide", () => {
    expect(pickFromHistory("723 SPSA PVEA PURUCHUCO", history)).toBeNull();
  });

  it("un comercio desconocido no inventa nada", () => {
    expect(pickFromHistory("FERRETERIA QUE NUNCA COMPRE", history)).toBeNull();
    expect(pickFromHistory("", history)).toBeNull();
    expect(pickFromHistory(null, history)).toBeNull();
  });

  it("el nivel exacto manda sobre la familia", () => {
    // «Yape Movilidad» tiene su propio historial: no debe heredar el «Otros»
    // del cubo YAPE, que además es ambiguo.
    const conExacto: HistoryRow[] = [
      ...history,
      { merchant: "Yape Movilidad", category: "Movilidad Taxi" },
    ];

    expect(pickFromHistory("Yape Movilidad", conExacto)).toMatchObject({
      category: "Movilidad Taxi",
      level: "exacto",
    });
  });

  it("«Sin categoría» no cuenta como precedente", () => {
    const soloVacios: HistoryRow[] = repeat({ merchant: "TIENDA X", category: null }, 5);
    expect(pickFromHistory("TIENDA X", soloVacios)).toBeNull();
  });

  it("una familia con un solo comercio detrás no decide", () => {
    // Una familia es una hipótesis; con un comercio no está demostrada.
    const flojo: HistoryRow[] = repeat({ merchant: "MARCA UNICA CENTRO", category: "Hogar" }, 5);
    expect(pickFromHistory("MARCA UNICA OTRA SEDE", flojo)).toBeNull();
  });
});

describe("depuración de lo que sale hacia Gemini", () => {
  it("corta el identificador que la ingesta pone tras el punto medio", () => {
    // El comentario real del usuario lleva el número de línea detrás del «·».
    expect(redactComment("PAGO CON NUMERO TELEFONO · 979336700")).toBe(
      "PAGO CON NUMERO TELEFONO",
    );
  });

  it("borra cualquier ristra larga de dígitos que sobreviva", () => {
    expect(redactComment("Recibo 000000000000202609030849")).toBe("Recibo");
    // Un importe corto sí es información útil y se conserva.
    expect(redactComment("Propina 12")).toBe("Propina 12");
  });

  it("deja el dominio del correo pero no la dirección", () => {
    expect(redactComment("Pago a joseph@gmail.com")).toBe("Pago a gmail.com");
  });

  it("recorta lo demasiado largo", () => {
    expect((redactComment("x".repeat(500)) ?? "").length).toBeLessThanOrEqual(120);
    expect(redactMerchant("Y".repeat(500)).length).toBeLessThanOrEqual(80);
  });

  it("un comentario vacío es null, no una cadena rara", () => {
    expect(redactComment(null)).toBeNull();
    expect(redactComment("  ·  algo")).toBeNull();
  });
});

function repeat<T>(value: T, times: number): T[] {
  return Array.from({ length: times }, () => ({ ...value }));
}

describe("la respuesta de Gemini se contrasta con el catálogo", () => {
  it("acepta una categoría del catálogo", () => {
    expect(matchCatalogue("Servicios")).toBe("Servicios");
    expect(matchCatalogue("Gas Cálidda")).toBe("Gas Cálidda");
  });

  it("tolera que llegue sin tildes o con espacios", () => {
    expect(matchCatalogue("Educacion")).toBe("Educación");
    expect(matchCatalogue("  Delivery  ")).toBe("Delivery");
  });

  it("rechaza cualquier cosa que no esté en el catálogo", () => {
    // El `enum` del esquema ya lo restringe, pero se revalida igual: confiar en
    // que el proveedor respete su propio contrato es la clase de suposición que
    // rompe en producción.
    // «GASTOS FIJOS» es un GRUPO, no una categoría: el modelo no decide grupos.
    for (const value of ["Cripto", "GASTOS FIJOS", "", "  ", null, 42, {}, ["Servicios"]]) {
      expect(matchCatalogue(value)).toBeNull();
    }
  });

  it("una categoría en mayúsculas sí se reconoce", () => {
    // No es un fallo: «INGRESOS» es la categoría «Ingresos» escrita a gritos.
    expect(matchCatalogue("INGRESOS")).toBe("Ingresos");
  });

  it("«NINGUNA» significa que no hay sugerencia", () => {
    expect(matchCatalogue("NINGUNA")).toBeNull();
  });

  it("no acepta el centinela interno de «sin categoría»", () => {
    expect(matchCatalogue("__sin_categoria__")).toBeNull();
  });
});
