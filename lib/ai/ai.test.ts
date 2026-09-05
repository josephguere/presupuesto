import { describe, expect, it } from "vitest";
import { combineWindows, toWindowResult } from "./rateLimit";
import { classifyGeminiError, fromGemini, scrubSecrets } from "./errors";
import { startDeadline, stageTimeoutMs } from "./deadline";
import {
  buildDeterministicAnswer,
  collectAllowedNumbers,
  finalAnswer,
  inventsNumbers,
} from "./answer";
import {
  CLIENT_TIMEOUT_MS,
  GENERIC_ERROR_MESSAGE,
  OUT_OF_SCOPE_MESSAGE,
  REQUEST_BUDGET_MS,
} from "./limits";
import type { AnswerPayload } from "./present";

/**
 * Las piezas puras del chat: consumo, errores y redacción.
 *
 * Sin red, sin reloj real y sin base de datos. El tiempo se inyecta, así que el
 * límite y el presupuesto se prueban sin esperar un minuto de verdad.
 */

describe("los textos fijados por el usuario", () => {
  it("el de fuera de alcance es exacto, letra por letra", () => {
    expect(OUT_OF_SCOPE_MESSAGE).toBe(
      "Solo puedo responder preguntas relacionadas con tus movimientos y datos de presupuesto.",
    );
  });

  it("el de error es exacto", () => {
    expect(GENERIC_ERROR_MESSAGE).toBe(
      "No pude consultar tus datos en este momento. Inténtalo nuevamente.",
    );
  });
});

describe("la cadena de tiempos", () => {
  it("el cliente espera más que el servidor, y el servidor más que su presupuesto", () => {
    // Si se invirtiera, el usuario vería su propio error de red en lugar del
    // mensaje que el servidor sabe redactar. `maxDuration` está en la ruta.
    const maxDuration = 30;

    expect(CLIENT_TIMEOUT_MS).toBeGreaterThan(maxDuration * 1000);
    expect(maxDuration * 1000).toBeGreaterThan(REQUEST_BUDGET_MS);
  });
});

describe("presupuesto de tiempo", () => {
  it("una etapa nunca puede pedir más de lo que queda", () => {
    let ahora = 0;
    const deadline = startDeadline(10_000, () => ahora);

    expect(stageTimeoutMs(deadline, 8_000)).toBe(8_000);

    ahora = 7_000;
    expect(stageTimeoutMs(deadline, 8_000)).toBe(3_000);

    ahora = 12_000;
    expect(deadline.expired()).toBe(true);
    expect(stageTimeoutMs(deadline, 8_000)).toBe(0);

    deadline.release();
  });
});

describe("límite de consumo", () => {
  it("una fila ilegible BLOQUEA", () => {
    // Si no se entiende el contador, no se sabe cuántos mensajes van. En la duda
    // no se gasta cuota.
    for (const basura of [null, undefined, "vale", 42, {}]) {
      expect(toWindowResult(basura).allowed).toBe(false);
    }
  });

  it("lee la fila de la función de PostgreSQL", () => {
    expect(toWindowResult({ hits: 3, allowed: true, retry_after_seconds: 0 })).toEqual({
      allowed: true,
      hits: 3,
      retryAfterSeconds: 0,
    });
  });

  it("manda la ventana más restrictiva", () => {
    const ok = { allowed: true, hits: 1, retryAfterSeconds: 0 };
    const corta = { allowed: false, hits: 9, retryAfterSeconds: 42 };

    expect(combineWindows(ok, ok)).toMatchObject({ allowed: true, scope: null });
    expect(combineWindows(corta, ok)).toMatchObject({ scope: "minuto", retryAfterSeconds: 42 });
    expect(combineWindows(ok, corta)).toMatchObject({ scope: "dia" });
  });

  it("empatadas gana el minuto, que es el consejo útil", () => {
    // Decirle a alguien que vuelva mañana cuando en diez segundos puede seguir
    // sería mentirle.
    const corta = { allowed: false, hits: 9, retryAfterSeconds: 10 };

    expect(combineWindows(corta, corta).scope).toBe("minuto");
  });
});

describe("clasificación de los errores del modelo", () => {
  it("reconoce la cuota agotada por código y por mensaje", () => {
    expect(classifyGeminiError({ status: 429 }).kind).toBe("cuota");
    expect(classifyGeminiError(new Error("RESOURCE_EXHAUSTED: quota")).kind).toBe("cuota");
  });

  it("reconoce el modelo inexistente", () => {
    // El caso real: `gemini-2.5-flash-lite` ya no se sirve a claves nuevas.
    expect(classifyGeminiError({ status: 404 }).kind).toBe("modelo");
  });

  it("reconoce el aborto de nuestro propio presupuesto", () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";

    expect(classifyGeminiError(abort).kind).toBe("abortada");
  });

  it("solo la cuota tiene mensaje propio", () => {
    // Para el usuario, un 404 de modelo y un fallo de red significan lo mismo:
    // no se pudo. La cuota es la única en la que esperar sirve de algo.
    expect(fromGemini({ status: 429 }, "intencion").userMessage).toContain("cuota");
    expect(fromGemini({ status: 404 }, "intencion").userMessage).toBe(GENERIC_ERROR_MESSAGE);
    expect(fromGemini(new Error("socket hang up"), "redaccion").userMessage).toBe(
      GENERIC_ERROR_MESSAGE,
    );
  });

  it("la clave nunca llega al log", () => {
    const sucio = "GET https://x.com/v1?key=AIzaSyD1234567890abcdef failed";

    expect(scrubSecrets(sucio)).not.toContain("AIzaSyD1234567890abcdef");
    expect(scrubSecrets("Authorization: Bearer abc.def.ghi")).toContain("Bearer ***");
  });

  it("el detalle técnico se recorta", () => {
    expect(scrubSecrets("x".repeat(1000)).length).toBeLessThanOrEqual(200);
  });
});

/* -------------------------------------------------------------------------- */
/* Redacción                                                                   */
/* -------------------------------------------------------------------------- */

function payload(overrides: Partial<AnswerPayload> = {}): AnswerPayload {
  return {
    intencion: "total_expenses",
    periodo: "septiembre de 2026",
    periodoComparado: null,
    filtros: [],
    hechos: [
      { etiqueta: "Gastos del período", valor: "S/ 1,286.20" },
      { etiqueta: "Movimientos", valor: "14 movimientos" },
    ],
    filas: [],
    totalFilas: 14,
    sinDatos: false,
    avisos: [],
    notasModelo: [],
    ...overrides,
  };
}

describe("el chat no puede inventar cifras", () => {
  it("acepta los importes que se le dieron", () => {
    const permitidos = collectAllowedNumbers(payload());

    expect(inventsNumbers("Gastaste S/ 1,286.20 en 14 movimientos.", permitidos)).toBe(false);
  });

  it("acepta la parte entera de un importe permitido", () => {
    // «unos 1,286 soles» es redactar, no inventar.
    const permitidos = collectAllowedNumbers(payload());

    expect(inventsNumbers("Gastaste unos 1,286 soles.", permitidos)).toBe(false);
  });

  it("detecta un importe que no estaba en los datos", () => {
    const permitidos = collectAllowedNumbers(payload());

    expect(inventsNumbers("Gastaste S/ 9,999.99 este mes.", permitidos)).toBe(true);
  });

  it("no confunde ordinales ni años con importes", () => {
    const permitidos = collectAllowedNumbers(payload());

    expect(inventsNumbers("Los 5 más altos suman S/ 1,286.20 en 2026.", permitidos)).toBe(false);
  });

  it("una respuesta con cifras inventadas se sustituye por la del servidor", () => {
    const datos = payload();
    const { text, fuente } = finalAnswer("Gastaste S/ 42,000.00 este mes.", datos);

    expect(fuente).toBe("servidor");
    expect(text).toContain("S/ 1,286.20");
    expect(text).not.toContain("42,000");
  });

  it("una respuesta correcta se conserva tal cual", () => {
    const { text, fuente } = finalAnswer("Gastaste S/ 1,286.20 en septiembre.", payload());

    expect(fuente).toBe("gemini");
    expect(text).toBe("Gastaste S/ 1,286.20 en septiembre.");
  });

  it("sin respuesta del modelo, responde el servidor", () => {
    // Es el mismo camino que cubre el tiempo agotado y la falta de clave: por eso
    // verificar sale casi gratis.
    const { text, fuente } = finalAnswer(null, payload());

    expect(fuente).toBe("servidor");
    expect(text).toContain("S/ 1,286.20");
  });
});

describe("la respuesta del servidor", () => {
  it("nunca imprime undefined, ni siquiera sin hechos", () => {
    const texto = buildDeterministicAnswer(
      payload({ hechos: [], filas: [], totalFilas: 0 }),
    );

    expect(texto).not.toContain("undefined");
    expect(texto).toContain("septiembre de 2026");
  });

  it("dice cuándo no hay datos, sin inventar una cifra", () => {
    const texto = buildDeterministicAnswer(payload({ sinDatos: true, hechos: [] }));

    expect(texto).toContain("No encontré movimientos");
    expect(texto).not.toMatch(/S\/\s?\d/);
  });

  it("nombra los filtros aplicados", () => {
    const texto = buildDeterministicAnswer(payload({ filtros: ["categoría Delivery"] }));

    expect(texto).toContain("categoría Delivery");
  });

  it("incorpora los avisos", () => {
    const texto = buildDeterministicAnswer(payload({ avisos: ["La consulta alcanzó el tope."] }));

    expect(texto).toContain("La consulta alcanzó el tope.");
  });

  it("NO imprime las instrucciones dirigidas al modelo", () => {
    // Los dos arrays existen justo para esto: `avisos` se puede leer en voz
    // alta, `notasModelo` son ordenes del prompt y enseñarlas seria mostrarle al
    // usuario las tripas del sistema.
    const texto = buildDeterministicAnswer(
      payload({
        avisos: ["La consulta alcanzó el tope."],
        notasModelo: ["Solo se muestran 25 de 50 filas; no afirmes que es la lista completa."],
      }),
    );

    expect(texto).toContain("La consulta alcanzó el tope.");
    expect(texto).not.toContain("no afirmes");
  });

  it("las cifras de las notas al modelo siguen siendo legítimas", () => {
    // El modelo puede citar «25 de 50» aunque la nota no se pinte; si no
    // estuvieran permitidas, su respuesta correcta se descartaria por inventada.
    const permitidos = collectAllowedNumbers(
      payload({ notasModelo: ["Solo se muestran 25 de 50 filas."] }),
    );

    expect(inventsNumbers("Te muestro 25 de 50 movimientos.", permitidos)).toBe(false);
  });
});
