import { describe, expect, it } from "vitest";
import { buildCatalog, catalogEnums, catalogKey, describeCatalog, editDistanceAtMost, resolveCategory, resolveCategoryMatch, resolveGroup } from "./catalog";
import { buildIntentResponseSchema, historyNote, parseIntent } from "./intent";
import { OUT_OF_SCOPE_MESSAGE } from "./limits";
import { resolvePeriod } from "@/lib/period";

/**
 * Validación de la intención y catálogo.
 *
 * AQUÍ NO HAY NINGÚN DOBLE DE SUPABASE, y es intencionado: si alguna de estas
 * pruebas necesitara uno, sería la señal de que se está consultando la base de
 * datos antes de haber validado lo que el modelo devolvió.
 */

const AHORA = new Date("2026-09-05T17:00:00Z");

/** Catálogo con las categorías del código más una huérfana de los datos. */
const catalogo = buildCatalog([
  { category: "Delivery", movimientos: 12 },
  { category: "Supermercado", movimientos: 30 },
  { category: "Cripto", movimientos: 3 },
]);

/** Lo mínimo que el esquema obliga a rellenar. */
function respuesta(overrides: Record<string, unknown> = {}) {
  return {
    enAlcance: true,
    intencion: "total_expenses",
    periodo: "este_mes",
    periodoDias: 0,
    periodoMes: 0,
    periodoAno: 0,
    periodoDesde: "",
    periodoHasta: "",
    periodoComparado: "NINGUNA",
    metrica: "gastos",
    categoria: "NINGUNA",
    categoriaResumen: "NINGUNA",
    grupo: "NINGUNA",
    sinCategoria: false,
    comercio: "",
    orden: "recientes",
    limite: 0,
    ...overrides,
  };
}

describe("catálogo híbrido", () => {
  it("une las categorías del código con las que solo están en los datos", () => {
    // «Cripto» no existe en lib/categories.ts pero sí en los movimientos: entra
    // igual, porque se puede consultar. Lo que no tiene es grupo.
    const huerfana = catalogo.categorias.find((entry) => entry.nombre === "Cripto");

    expect(huerfana).toMatchObject({ huerfana: true, grupo: null, movimientos: 3 });
  });

  it("una categoría del código sin movimientos sigue estando", () => {
    // Si solo saliera de los datos, no se podría preguntar por una categoría
    // recién añadida hasta tener el primer movimiento.
    expect(catalogo.categorias.find((entry) => entry.nombre === "Ropa")).toMatchObject({
      movimientos: 0,
      huerfana: false,
    });
  });

  it("el enum que ve el modelo incluye la huérfana y el centinela", () => {
    const enums = catalogEnums(catalogo);

    expect(enums.categorias).toContain("Cripto");
    expect(enums.categorias).toContain("NINGUNA");
    expect(enums.grupos).toEqual(["INGRESOS", "GASTOS FIJOS", "GASTOS VARIABLES", "NINGUNA"]);
  });

  it("el texto del prompt describe la jerarquía y separa las huérfanas", () => {
    const texto = describeCatalog(catalogo);

    expect(texto).toContain("GASTOS VARIABLES");
    expect(texto).toContain("Alimentación: Supermercado, Restaurantes, Delivery");
    expect(texto).toContain("SIN GRUPO ASIGNADO: Cripto");
  });

  it("el esquema se construye con el catálogo vigente", () => {
    const schema = buildIntentResponseSchema(catalogo) as {
      properties: { categoria: { enum: string[] } };
    };

    expect(schema.properties.categoria.enum).toContain("Cripto");
  });
});

describe("emparejamiento tolerante", () => {
  it("ignora mayúsculas, tildes y plural", () => {
    expect(resolveCategory(catalogo, "delivery")).toBe("Delivery");
    expect(resolveCategory(catalogo, "educacion")).toBe("Educación");
    expect(resolveCategory(catalogo, "Transferencia")).toBe("Transferencias");
  });

  it("perdona una errata en un término largo", () => {
    expect(resolveCategory(catalogo, "Supermercdo")).toBe("Supermercado");
  });

  it("no inventa nada con un término corto", () => {
    // Con tres letras, una errata es literalmente otra palabra.
    expect(resolveCategory(catalogo, "Luv")).toBeNull();
  });

  it("varios candidatos NO deciden", () => {
    // «Mantenimiento» existe suelto y también como «Mantenimiento Vehículo».
    // El nombre completo sí decide, porque es exacto.
    expect(resolveCategoryMatch(catalogo, "mantenimiento vehiculo").estado).toBe("encontrada");

    // Pero un término a medias encaja con los dos, y coger el primero daría un
    // total correcto de la categoría equivocada. Se pregunta en vez de acertar
    // por casualidad.
    const ambigua = resolveCategoryMatch(catalogo, "mantenimient");

    expect(ambigua.estado).toBe("ambigua");
    if (ambigua.estado === "ambigua") {
      expect(ambigua.candidatos).toEqual(["Mantenimiento", "Mantenimiento Vehículo"]);
    }
  });

  it("los grupos también se emparejan sin tildes ni mayúsculas", () => {
    expect(resolveGroup(catalogo, "gastos fijos")).toBe("GASTOS FIJOS");
    expect(resolveGroup(catalogo, "ingresos")).toBe("INGRESOS");
  });

  it("la clave normaliza igual dos formas de escribir lo mismo", () => {
    expect(catalogKey("Café y snacks")).toBe(catalogKey("cafe y snack"));
    // «Gas» conserva la ese: el recorte del plural solo toca palabras de más de
    // tres letras, para no convertir «gas» en «ga».
    expect(catalogKey("Gas Cálidda")).toBe("gas calidda");
  });

  it("la distancia se corta en el máximo pedido", () => {
    expect(editDistanceAtMost("delivery", "delivry", 1)).toBe(1);
    expect(editDistanceAtMost("delivery", "supermercado", 1)).toBeNull();
    // Transposición: es un error, no dos.
    expect(editDistanceAtMost("delviery", "delivery", 1)).toBe(1);
  });
});

describe("fuera de alcance", () => {
  it("respeta la decisión del modelo", () => {
    const parsed = parseIntent(respuesta({ enAlcance: false }), catalogo, AHORA);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.rechazo.motivo).toBe("fuera_de_alcance");
      expect(parsed.rechazo.mensaje).toBe(OUT_OF_SCOPE_MESSAGE);
    }
  });

  it("una intención que no está entre las doce se rechaza igual", () => {
    // Es la segunda cerradura: aunque el modelo dijera enAlcance=true, sin una
    // de las doce no hay nada que ejecutar.
    const parsed = parseIntent(
      respuesta({ enAlcance: true, intencion: "drop_table" }),
      catalogo,
      AHORA,
    );

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.rechazo.mensaje).toBe(OUT_OF_SCOPE_MESSAGE);
  });

  it("una respuesta ilegible no revienta", () => {
    for (const basura of [null, undefined, "texto", 42, []]) {
      const parsed = parseIntent(basura, catalogo, AHORA);
      expect(parsed.ok).toBe(false);
    }
  });

  it("un JSON roto de Gemini NO se confunde con fuera de alcance", () => {
    // Si el modelo devuelve basura, la pregunta del usuario podía estar
    // perfectamente dentro del alcance: quien falló fue el modelo. Decirle «solo
    // respondo sobre tus movimientos» le hace creer que preguntó mal y no
    // reintentar, que es justo lo que arregla este caso.
    const parsed = parseIntent(null, catalogo, AHORA);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.rechazo.motivo).toBe("respuesta_ilegible");
      expect(parsed.rechazo.mensaje).toBe(
        "No pude consultar tus datos en este momento. Inténtalo nuevamente.",
      );
      expect(parsed.rechazo.mensaje).not.toBe(OUT_OF_SCOPE_MESSAGE);
    }
  });

  it("el texto de fuera de alcance es EXACTAMENTE el pedido", () => {
    // Lo fijó el usuario letra por letra. Si alguien lo «mejora», esto lo para.
    expect(OUT_OF_SCOPE_MESSAGE).toBe(
      "Solo puedo responder preguntas relacionadas con tus movimientos y datos de presupuesto.",
    );
  });
});

describe("la inyección no puede ampliar lo que se puede hacer", () => {
  it("un enAlcance inyectado sigue limitado a las doce intenciones", () => {
    // El peor caso: el modelo obedece a un texto malicioso y marca la pregunta
    // como válida. Lo máximo que consigue es OTRA de las doce consultas de solo
    // lectura sobre los datos del propio usuario.
    const parsed = parseIntent(
      respuesta({ enAlcance: true, intencion: "total_income" }),
      catalogo,
      AHORA,
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.intent.intencion).toBe("total_income");
  });

  it("una categoría inventada NO se convierte en filtro", () => {
    const parsed = parseIntent(
      respuesta({ categoria: "'; drop table transactions; --" }),
      catalogo,
      AHORA,
    );

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.rechazo.motivo).toBe("intencion_incoherente");
      // El mensaje lo redacta el servidor y solo nombra categorías reales.
      expect(parsed.rechazo.mensaje).toContain("No tengo ninguna categoría");
    }
  });

  it("el comercio es texto libre pero se recorta", () => {
    const parsed = parseIntent(
      respuesta({ intencion: "merchant_total", comercio: "X".repeat(500) }),
      catalogo,
      AHORA,
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.intent.filtros.comercio?.length).toBe(80);
  });
});

describe("normalización de la intención", () => {
  it("un total de categoría sin categoría se convierte en desglose", () => {
    // «¿cuánto gasté por categoría?» acaba aquí a menudo, y el desglose es
    // exactamente lo que esa pregunta quería.
    const parsed = parseIntent(respuesta({ intencion: "category_total" }), catalogo, AHORA);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.intent.intencion).toBe("category_breakdown");
  });

  it("un total de grupo sin grupo se convierte en desglose por grupos", () => {
    const parsed = parseIntent(respuesta({ intencion: "group_total" }), catalogo, AHORA);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.intent.intencion).toBe("group_breakdown");
  });

  it("con grupo, el total de grupo se respeta", () => {
    const parsed = parseIntent(
      respuesta({ intencion: "group_total", grupo: "GASTOS FIJOS" }),
      catalogo,
      AHORA,
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.intent.intencion).toBe("group_total");
      expect(parsed.intent.filtros.grupo).toBe("GASTOS FIJOS");
    }
  });

  it("un total de comercio sin comercio se rechaza con un mensaje útil", () => {
    const parsed = parseIntent(respuesta({ intencion: "merchant_total" }), catalogo, AHORA);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.rechazo.mensaje).toContain("comercio");
  });

  it("el límite se recorta al tope de la intención", () => {
    const parsed = parseIntent(
      respuesta({ intencion: "highest_transactions", limite: 9999 }),
      catalogo,
      AHORA,
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.intent.intencion === "highest_transactions") {
      expect(parsed.intent.limite).toBe(20);
    }
  });

  it("sin límite se usa el de por defecto", () => {
    const parsed = parseIntent(respuesta({ intencion: "transaction_list" }), catalogo, AHORA);

    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.intent.intencion === "transaction_list") {
      expect(parsed.intent.limite).toBe(20);
    }
  });
});

describe("comparación de períodos", () => {
  it("sin segundo período se deriva el anterior natural", () => {
    // «¿gasté más que el mes pasado?» no debe fallar por un campo omitido.
    const parsed = parseIntent(
      respuesta({ intencion: "period_comparison", periodo: "este_mes" }),
      catalogo,
      AHORA,
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.intent.intencion === "period_comparison") {
      expect(parsed.intent.periodoComparado).toEqual({ kind: "mes_anterior" });
    }
  });

  it("comparar «todo el historial» se rechaza: no hay anterior", () => {
    const parsed = parseIntent(
      respuesta({ intencion: "period_comparison", periodo: "todo" }),
      catalogo,
      AHORA,
    );

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.rechazo.motivo).toBe("intencion_incoherente");
  });
});

describe("períodos dentro de la intención", () => {
  it("un período ilegible cae al mes en curso", () => {
    const parsed = parseIntent(respuesta({ periodo: "el mes que viene" }), catalogo, AHORA);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.intent.periodo).toEqual({ kind: "este_mes" });
  });

  it("«últimos N días» necesita el número", () => {
    const conDias = parseIntent(
      respuesta({ periodo: "ultimos_dias", periodoDias: 30 }),
      catalogo,
      AHORA,
    );
    expect(conDias.ok && conDias.intent.periodo).toEqual({ kind: "ultimos_dias", days: 30 });

    // Sin número no es una ventana: se degrada en vez de inventar una duración.
    const sinDias = parseIntent(respuesta({ periodo: "ultimos_dias" }), catalogo, AHORA);
    expect(sinDias.ok && sinDias.intent.periodo).toEqual({ kind: "este_mes" });
  });
});

describe("la nota del historial", () => {
  it("resume la consulta sin arrastrar texto del modelo", () => {
    const parsed = parseIntent(
      respuesta({ intencion: "category_total", categoria: "Delivery" }),
      catalogo,
      AHORA,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const period = resolvePeriod(parsed.intent.periodo, AHORA);
    const nota = historyNote(parsed.intent, period);

    expect(nota).toContain("category_total");
    expect(nota).toContain("Delivery");
    expect(nota).toContain("septiembre");
  });
});
