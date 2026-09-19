import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ejecución de las intenciones contra la base de datos.
 *
 * El doble de Supabase APLICA los filtros que le llegan, igual que el de
 * `lib/transactions.test.ts`. Sin eso, estas pruebas pasarían aunque el filtro de
 * `activo` no existiera —y entonces el chat contaría movimientos eliminados—,
 * que es justo el fallo que hay que poder detectar aquí.
 */

interface Row {
  [column: string]: unknown;
}

const state = vi.hoisted(() => ({ rows: [] as Row[] }));

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({ from: () => createQuery() }),
}));

function createQuery() {
  const equals: Array<[string, unknown]> = [];
  const nulls: string[] = [];
  const inLists: Array<[string, unknown[]]> = [];
  const ranges: Array<[string, "gte" | "lt", string]> = [];
  const orders: Array<[string, boolean]> = [];
  const ors: string[] = [];
  const ilikes: Array<[string, string]> = [];

  const query = {
    select: () => query,
    order(column: string, options?: { ascending?: boolean }) {
      orders.push([column, options?.ascending ?? true]);
      return query;
    },
    limit: () => query,
    abortSignal: () => query,
    or(expression: string) {
      ors.push(expression);
      return query;
    },
    /**
     * `ilike` de verdad: parcial y sin distinguir mayusculas.
     *
     * Se evalua en serio —no se acepta y ya— porque es justo lo que hay que
     * comprobar de la busqueda por comentario. Un `NULL` nunca casa, igual
     * que en SQL.
     */
    ilike(column: string, pattern: string) {
      ilikes.push([column, pattern]);
      return query;
    },
    eq(column: string, value: unknown) {
      equals.push([column, value]);
      return query;
    },
    is(column: string, value: unknown) {
      if (value === null) nulls.push(column);
      return query;
    },
    not: () => query,
    in(column: string, values: unknown[]) {
      inLists.push([column, values]);
      return query;
    },
    gte(column: string, value: string) {
      ranges.push([column, "gte", value]);
      return query;
    },
    lt(column: string, value: string) {
      ranges.push([column, "lt", value]);
      return query;
    },
    returns() {
      const data = state.rows.filter(
        (row) =>
          ors.every((expression) => matchesOr(row, expression)) &&
          ilikes.every(([column, pattern]) => {
            const value = row[column];
            if (value === null || value === undefined) return false;
            const needle = pattern.replace(/^%|%$/g, "").toLowerCase();
            return String(value).toLowerCase().includes(needle);
          }) &&
          equals.every(([column, value]) => row[column] === value) &&
          nulls.every((column) => row[column] === null) &&
          inLists.every(([column, values]) => values.includes(row[column])) &&
          ranges.every(([column, operator, value]) => {
            const actual = String(row[column]);
            return operator === "gte" ? actual >= value : actual < value;
          }),
      );

      const ordenado = [...data].sort((a, b) => {
        for (const [column, ascending] of orders) {
          if (a[column] === b[column]) continue;
          const comparacion =
            column === "amount"
              ? Number(a[column]) - Number(b[column])
              : String(a[column]).localeCompare(String(b[column]));
          return ascending ? comparacion : -comparacion;
        }
        return 0;
      });

      return Promise.resolve({ data: ordenado, error: null });
    },
  };

  return query;
}

const { executeIntent } = await import("./execute");
const { buildCatalog } = await import("./catalog");
const { parseIntent } = await import("./intent");
const { toAnswerPayload, toChatResult } = await import("./present");
const { resolvePeriod } = await import("@/lib/period");

const AHORA = new Date("2026-09-15T17:00:00Z");
const catalogo = buildCatalog([]);

function row(overrides: Row = {}): Row {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    bank: "BCP",
    operation_type: "Consumo Tarjeta de Débito",
    transaction_at: "2026-09-10T12:00:00-05:00",
    amount: "100.00",
    currency: "PEN",
    merchant: "PLAZA VEA",
    card_last4: "3400",
    operation_number: "000123456",
    category: "Supermercado",
    comment: "PAGO CON NUMERO TELEFONO · 979336700",
    origin: "EMAIL",
    activo: true,
    contabilizar: true,
    is_test: false,
    eliminado_at: null,
    ...overrides,
  };
}

/** Atajo: de una respuesta del modelo a un resultado ejecutado. */
async function ejecutar(respuesta: Record<string, unknown>) {
  const parsed = parseIntent(
    {
      enAlcance: true,
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
      periodo: "este_mes",
      ...respuesta,
    },
    catalogo,
    AHORA,
  );

  if (!parsed.ok) throw new Error(`intención rechazada: ${parsed.rechazo.detalle}`);

  const period = resolvePeriod(parsed.intent.periodo, AHORA);
  const comparePeriod =
    parsed.intent.intencion === "period_comparison"
      ? resolvePeriod(parsed.intent.periodoComparado, AHORA)
      : undefined;

  return executeIntent(parsed.intent, period, { comparePeriod });
}

beforeEach(() => {
  state.rows = [];
});

describe("lo que NO puede salir", () => {
  it("el resultado no contiene tarjeta, número de operación ni comentario", async () => {
    state.rows = [row()];

    const result = await ejecutar({ intencion: "transaction_list" });
    const serializado = JSON.stringify(result);

    // La comprobación va sobre el JSON COMPLETO: es la única forma de detectar
    // que alguien añada un campo nuevo que arrastre uno de estos.
    expect(serializado).not.toContain("3400");
    expect(serializado).not.toContain("000123456");
    expect(serializado).not.toContain("979336700");
    expect(serializado).not.toContain("11111111-1111");
  });

  it("tampoco salen hacia el prompt de redacción", async () => {
    state.rows = [row()];

    const result = await ejecutar({ intencion: "transaction_list" });
    const payload = JSON.stringify(toAnswerPayload(result));

    expect(payload).not.toContain("3400");
    expect(payload).not.toContain("000123456");
    expect(payload).not.toContain("979336700");
  });
});

describe("los movimientos eliminados no cuentan", () => {
  it("una baja lógica queda fuera del total", async () => {
    state.rows = [
      row({ amount: "100.00" }),
      row({ id: "2", amount: "999.00", activo: false, eliminado_at: "2026-09-11T00:00:00Z" }),
    ];

    const result = await ejecutar({ intencion: "total_expenses" });

    expect(result.metricas[0].valor).toBe(100);
  });
});

describe("totales", () => {
  it("gastos, ingresos y balance salen del mismo resumen que la pantalla", async () => {
    state.rows = [
      row({ amount: "100.00", category: "Supermercado" }),
      row({ id: "2", amount: "50.00", category: "Delivery" }),
      row({ id: "3", amount: "1000.00", category: "Ingresos" }),
    ];

    const gastos = await ejecutar({ intencion: "total_expenses" });
    expect(gastos.metricas[0]).toMatchObject({ valor: 150, texto: expect.stringContaining("150") });

    const ingresos = await ejecutar({ intencion: "total_income" });
    expect(ingresos.metricas[0].valor).toBe(1000);

    const balance = await ejecutar({ intencion: "balance" });
    expect(balance.metricas[0].valor).toBe(850);
  });

  it("los importes viajan como número Y como texto formateado", async () => {
    state.rows = [row({ amount: "1286.20" })];

    const result = await ejecutar({ intencion: "total_expenses" });

    // Al navegador el número; al modelo la cadena. Ver `lib/ai/present.ts`.
    expect(result.metricas[0].valor).toBe(1286.2);
    expect(result.metricas[0].texto).toMatch(/S\/\s?1,286\.20/);
  });

  it("lo que no tiene categoría se cuenta aparte, no se reparte", async () => {
    state.rows = [row({ amount: "100.00" }), row({ id: "2", amount: "40.00", category: null })];

    const result = await ejecutar({ intencion: "total_expenses" });
    const pendiente = result.metricas.find((metrica) => metrica.clave === "pendiente");

    expect(pendiente?.valor).toBe(40);
  });
});

describe("filtros de clasificación", () => {
  it("una categoría filtra por esa categoría", async () => {
    state.rows = [
      row({ amount: "100.00", category: "Supermercado" }),
      row({ id: "2", amount: "30.00", category: "Delivery" }),
    ];

    const result = await ejecutar({ intencion: "category_total", categoria: "Delivery" });

    expect(result.metricas[0].valor).toBe(30);
  });

  it("una categoría resumen suma todas sus categorías", async () => {
    state.rows = [
      row({ amount: "100.00", category: "Supermercado" }),
      row({ id: "2", amount: "30.00", category: "Delivery" }),
      row({ id: "3", amount: "500.00", category: "Servicios" }),
    ];

    const result = await ejecutar({
      intencion: "category_total",
      categoriaResumen: "Alimentación",
    });

    expect(result.metricas[0].valor).toBe(130);
  });

  it("un grupo suma todas las categorías del grupo", async () => {
    state.rows = [
      row({ amount: "100.00", category: "Supermercado" }),
      row({ id: "2", amount: "500.00", category: "Servicios" }),
    ];

    const result = await ejecutar({
      intencion: "group_total",
      grupo: "GASTOS FIJOS",
    });

    expect(result.metricas[0].valor).toBe(500);
  });
});

describe("busqueda en el comentario", () => {
  /** Los movimientos del acuerdo: dos con «Hanna», uno con «Lley». */
  function conComentarios() {
    return [
      row({ id: "1", amount: "50.00", merchant: "PLAZA VEA", comment: "Regalo Hanna" }),
      row({ id: "2", amount: "30.00", merchant: "WONG", comment: "cumple de hanna" }),
      row({ id: "3", amount: "200.00", merchant: "BCP", comment: "Pago Lley septiembre" }),
      row({ id: "4", amount: "15.00", merchant: "TAMBO", comment: null }),
    ];
  }

  it("cuenta los movimientos que mencionan algo en el comentario", async () => {
    state.rows = conComentarios();

    const result = await ejecutar({ intencion: "transaction_count", comentario: "Hanna" });

    expect(result.metricas[0].valor).toBe(2);
  });

  it("no distingue mayusculas", async () => {
    // «Regalo Hanna» y «cumple de hanna» tienen que contar los dos.
    state.rows = conComentarios();

    const minusculas = await ejecutar({ intencion: "transaction_count", comentario: "hanna" });
    const mayusculas = await ejecutar({ intencion: "transaction_count", comentario: "HANNA" });

    expect(minusculas.metricas[0].valor).toBe(2);
    expect(mayusculas.metricas[0].valor).toBe(2);
  });

  it("suma el gasto de los movimientos con ese comentario", async () => {
    state.rows = conComentarios();

    const result = await ejecutar({ intencion: "total_expenses", comentario: "Lley" });

    expect(result.metricas[0].valor).toBe(200);
  });

  it("coincide de forma PARCIAL, no exacta", async () => {
    // «Lley» esta dentro de «Pago Lley septiembre»: buscar la palabra suelta
    // tiene que encontrarlo.
    state.rows = conComentarios();

    const result = await ejecutar({ intencion: "transaction_list", comentario: "Lley" });

    expect(result.filas).toHaveLength(1);
    expect(result.filas[0].etiqueta).toBe("BCP");
  });

  it("los movimientos SIN comentario nunca casan", async () => {
    state.rows = conComentarios();

    const result = await ejecutar({ intencion: "transaction_list", comentario: "a" });

    expect(result.filas.map((fila) => fila.etiqueta)).not.toContain("TAMBO");
  });

  it("se combina con el periodo y con la categoria", async () => {
    state.rows = [
      row({
        id: "1",
        amount: "50.00",
        category: "Regalos",
        comment: "Regalo Hanna",
        transaction_at: "2026-09-10T12:00:00-05:00",
      }),
      row({
        id: "2",
        amount: "80.00",
        category: "Supermercado",
        comment: "Regalo Hanna",
        transaction_at: "2026-09-11T12:00:00-05:00",
      }),
    ];

    const result = await ejecutar({
      intencion: "total_expenses",
      comentario: "Hanna",
      categoria: "Regalos",
    });

    // Solo el de Regalos: los dos filtros se cruzan, no se suman.
    expect(result.metricas[0].valor).toBe(50);
  });

  it("un comodin escrito por el usuario NO amplia la busqueda", async () => {
    // `%` es comodin de SQL. Si se dejara pasar, «%» devolveria el historial
    // entero y pareceria que el filtro no se aplico.
    state.rows = conComentarios();

    const result = await ejecutar({ intencion: "transaction_list", comentario: "%" });

    expect(result.filas).toHaveLength(0);
  });
});

describe("comercios", () => {
  it("encuentra todas las variantes del mismo nombre", async () => {
    // El caso real: seis formas distintas del mismo comercio en la base.
    state.rows = [
      row({ amount: "30.00", merchant: "DLC*PEDIDOSYA FOOD", category: "Delivery" }),
      row({ id: "2", amount: "5.00", merchant: "DLC*PedidosYa Propina", category: "Delivery" }),
      row({ id: "3", amount: "80.00", merchant: "PLAZA VEA", category: "Supermercado" }),
    ];

    const result = await ejecutar({ intencion: "merchant_total", comercio: "PedidosYa" });

    expect(result.metricas[0].valor).toBe(35);
    expect(result.filtros.comercioCoincidencia).toBe("familia");
  });

  it("un comercio sin movimientos lo DICE en vez de devolver el total de todo", async () => {
    state.rows = [row({ amount: "80.00", merchant: "PLAZA VEA" })];

    const result = await ejecutar({ intencion: "merchant_total", comercio: "FIBERPRO" });

    expect(result.vacio).toBe(true);
    expect(result.metricas).toEqual([]);
    expect(result.avisos.join(" ")).toContain("FIBERPRO");
  });
});

describe("listas", () => {
  it("los movimientos más altos vienen ordenados y recortados", async () => {
    state.rows = [
      row({ id: "1", amount: "10.00", merchant: "A" }),
      row({ id: "2", amount: "300.00", merchant: "B" }),
      row({ id: "3", amount: "50.00", merchant: "C" }),
    ];

    const result = await ejecutar({ intencion: "highest_transactions", limite: 2 });

    expect(result.filas.map((fila) => fila.etiqueta)).toEqual(["B", "C"]);
    expect(result.filasOmitidas).toBe(1);
  });
});

describe("desgloses", () => {
  it("«¿en qué grupo gasto más?» NO responde «Ingresos»", async () => {
    // El sueldo es siempre la cifra más alta del mes. Sin excluir los ingresos,
    // la pregunta se contestaba sola y mal, y el «total del período» era la suma
    // de lo que entra y lo que sale: un número sin significado.
    state.rows = [
      row({ amount: "100.00", category: "Supermercado" }),
      row({ id: "2", amount: "500.00", category: "Servicios" }),
      row({ id: "3", amount: "4000.00", category: "Ingresos" }),
    ];

    const result = await ejecutar({ intencion: "group_breakdown" });

    expect(result.filas.map((fila) => fila.etiqueta)).not.toContain("INGRESOS");
    expect(result.filas[0].etiqueta).toBe("GASTOS FIJOS");

    // El total es solo gasto, y los porcentajes se calculan contra esa base.
    const suma = result.filas.reduce((total, fila) => total + fila.total, 0);
    expect(suma).toBe(600);
    expect(result.metricas.find((m) => m.clave === "total")?.valor).toBe(600);
  });

  it("el desglose por categoría tampoco cuela los ingresos", async () => {
    state.rows = [
      row({ amount: "100.00", category: "Supermercado" }),
      row({ id: "2", amount: "4000.00", category: "Ingresos" }),
    ];

    const result = await ejecutar({ intencion: "category_breakdown" });

    expect(result.filas.map((fila) => fila.etiqueta)).not.toContain("Ingresos");
    expect(result.metricas[0].etiqueta).toContain("Mayor:");
    expect(result.metricas[0].valor).toBe(100);
  });

  it("pero si el usuario PIDE los ingresos, se los damos", async () => {
    // Excluirlos siempre convertiría «¿de dónde vienen mis ingresos?» en una
    // respuesta vacía.
    state.rows = [
      row({ amount: "100.00", category: "Supermercado" }),
      row({ id: "2", amount: "4000.00", category: "Ingresos" }),
    ];

    const result = await ejecutar({
      intencion: "category_breakdown",
      grupo: "INGRESOS",
    });

    expect(result.filas[0].etiqueta).toBe("Ingresos");
    expect(result.filas[0].total).toBe(4000);
  });

  it("un mes con sueldo pero sin un solo gasto no tiene desglose que enseñar", async () => {
    state.rows = [row({ amount: "4000.00", category: "Ingresos" })];

    const result = await ejecutar({ intencion: "group_breakdown" });

    expect(result.vacio).toBe(true);
  });

  it("los porcentajes se calculan en el servidor", async () => {
    state.rows = [
      row({ amount: "75.00", category: "Supermercado" }),
      row({ id: "2", amount: "25.00", category: "Servicios" }),
    ];

    const result = await ejecutar({ intencion: "category_breakdown", grupo: "NINGUNA" });

    expect(result.filas[0].porcentaje).toBe(75);
  });
});

describe("comparación de períodos", () => {
  it("compara dos períodos y calcula la variación", async () => {
    state.rows = [
      row({ transaction_at: "2026-09-10T12:00:00-05:00", amount: "150.00" }),
      row({ id: "2", transaction_at: "2026-08-10T12:00:00-05:00", amount: "100.00" }),
    ];

    const result = await ejecutar({ intencion: "period_comparison", periodo: "este_mes" });

    expect(result.metricas.find((m) => m.clave === "actual")?.valor).toBe(150);
    expect(result.metricas.find((m) => m.clave === "anterior")?.valor).toBe(100);
    expect(result.metricas.find((m) => m.clave === "diferencia")?.valor).toBe(50);
    expect(result.metricas.find((m) => m.clave === "variacion")?.texto).toBe("+50 %");
  });

  it("sin período anterior no se divide entre cero", async () => {
    // Un Infinity aquí lo escribiría el modelo tal cual.
    state.rows = [row({ transaction_at: "2026-09-10T12:00:00-05:00", amount: "150.00" })];

    const result = await ejecutar({ intencion: "period_comparison", periodo: "este_mes" });
    const variacion = result.metricas.find((m) => m.clave === "variacion");

    expect(variacion?.texto).toBe("no aplica");
  });
});

describe("períodos", () => {
  it("«todo» no filtra por fecha", async () => {
    state.rows = [
      row({ transaction_at: "2024-01-05T12:00:00-05:00", amount: "10.00" }),
      row({ id: "2", transaction_at: "2026-09-10T12:00:00-05:00", amount: "20.00" }),
    ];

    const result = await ejecutar({ intencion: "total_expenses", periodo: "todo" });

    // Sin esto, «todo el historial» se habría convertido en «este mes».
    expect(result.metricas[0].valor).toBe(30);
  });

  it("un mes concreto solo trae ese mes", async () => {
    state.rows = [
      row({ transaction_at: "2026-08-10T12:00:00-05:00", amount: "10.00" }),
      row({ id: "2", transaction_at: "2026-09-10T12:00:00-05:00", amount: "20.00" }),
    ];

    const result = await ejecutar({
      intencion: "total_expenses",
      periodo: "mes",
      periodoMes: 8,
      periodoAno: 2026,
    });

    expect(result.metricas[0].valor).toBe(10);
  });

  it("un período sin movimientos vuelve vacío, no falla", async () => {
    state.rows = [];

    const result = await ejecutar({ intencion: "total_expenses" });

    expect(result.vacio).toBe(true);
    expect(toChatResult(result)).toBeNull();
  });
});

describe("la tabla que ve el navegador", () => {
  it("lleva números, no texto formateado", async () => {
    state.rows = [row({ amount: "1286.20", merchant: "PLAZA VEA" })];

    const result = await ejecutar({ intencion: "transaction_list" });
    const tabla = toChatResult(result);

    expect(tabla?.rows[0]).toMatchObject({ label: "PLAZA VEA", amount: 1286.2 });
    expect(tabla?.columns).toEqual(["Movimiento", "Fecha", "Monto"]);
  });
});

/**
 * Evalua la unica forma de `or` que produce la aplicacion.
 *
 * `category.is.null,category.in.("Luz","Internet")` -> la categoria es nula O
 * esta en la lista. Cualquier otra forma hace fallar la prueba a proposito,
 * para que nadie cambie la consulta sin actualizar tambien el doble.
 */
function matchesOr(row: Row, expression: string): boolean {
  const isNull = expression.includes("category.is.null");

  const inList = expression.match(/category\.in\.\(([^)]*)\)/)?.[1];
  const values = inList
    ? inList.split(",").map((value) => value.trim().replace(/^"|"$/g, ""))
    : [];

  if (!isNull && values.length === 0) {
    throw new Error(`El doble no entiende este or(): ${expression}`);
  }

  if (isNull && row.category === null) return true;
  return values.includes(String(row.category));
}

describe("graficos", () => {
  it("un desglose por grupo lleva barras", async () => {
    state.rows = [
      row({ amount: "100.00", category: "Supermercado" }),
      row({ id: "2", amount: "500.00", category: "Servicios" }),
    ];

    const result = await ejecutar({ intencion: "group_breakdown" });
    const chart = toChatResult(result)?.chart;

    expect(chart?.type).toBe("bar");
    expect(chart?.points.map((p) => p.label)).toEqual(["GASTOS FIJOS", "GASTOS VARIABLES"]);
    expect(chart?.points.map((p) => p.value)).toEqual([500, 100]);
  });

  it("una comparacion de periodos lleva dos barras", async () => {
    state.rows = [
      row({ transaction_at: "2026-09-10T12:00:00-05:00", amount: "150.00" }),
      row({ id: "2", transaction_at: "2026-08-10T12:00:00-05:00", amount: "100.00" }),
    ];

    const result = await ejecutar({ intencion: "period_comparison", periodo: "este_mes" });
    const chart = toChatResult(result)?.chart;

    expect(chart?.type).toBe("bar");
    expect(chart?.points).toHaveLength(2);
  });

  it("una sola cifra NO lleva grafico", async () => {
    // Una barra sola no compara nada.
    state.rows = [row({ amount: "100.00" })];

    const result = await ejecutar({ intencion: "total_expenses" });

    expect(toChatResult(result)?.chart ?? null).toBeNull();
  });

  it("una lista de movimientos sueltos NO lleva grafico", async () => {
    // Son hechos individuales, no una distribucion.
    state.rows = [
      row({ id: "1", amount: "10.00", merchant: "A" }),
      row({ id: "2", amount: "20.00", merchant: "B" }),
    ];

    const result = await ejecutar({ intencion: "transaction_list" });

    expect(toChatResult(result)?.chart ?? null).toBeNull();
  });

  it("con un solo punto NO se grafica", async () => {
    // Un desglose de una sola categoria no tiene con que compararse.
    state.rows = [row({ amount: "100.00", category: "Supermercado" })];

    const result = await ejecutar({ intencion: "group_breakdown" });

    expect(toChatResult(result)?.chart ?? null).toBeNull();
  });

  it("la fila de resto no entra en el grafico", async () => {
    // «Otras N» es un agregado sintetico: pintarlo junto a categorias reales
    // invitaria a compararlo con ellas.
    //
    // Hacen falta MAS de 15 categorias distintas —el tope del desglose— para
    // que se genere esa fila, y todas del MISMO grupo para que el nivel sea
    // «categoria» y no «resumen».
    const variables = [
      "Supermercado",
      "Restaurantes",
      "Delivery",
      "Café y snacks",
      "Transporte",
      "Movilidad Taxi",
      "Peajes y estacionamiento",
      "Combustible",
      "Salud",
      "Farmacia",
      "Cuidado personal",
      "Entretenimiento",
      "Videojuegos",
      "Hogar",
      "Ropa",
      "Tecnología",
      "Viajes",
      "Regalos",
    ];

    state.rows = variables.map((category, index) =>
      row({ id: `r-${index}`, amount: `${100 - index}.00`, category, merchant: `M${index}` }),
    );

    const result = await ejecutar({
      intencion: "category_breakdown",
      grupo: "GASTOS VARIABLES",
    });

    // Primero: que la fila de resto EXISTA, o la prueba no estaria probando nada.
    expect(result.filas.some((fila) => fila.esResto)).toBe(true);

    const chart = toChatResult(result)?.chart;
    expect(chart).not.toBeNull();
    expect(chart?.points.some((point) => point.label.startsWith("Otras"))).toBe(false);
  });
});
