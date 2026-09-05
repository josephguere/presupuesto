import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { formatCurrency } from "@/lib/format";
import { getSummaryForCategory } from "@/lib/categories";
import type { Transaction } from "@/types/transaction";

/**
 * Qué muestra la tabla y qué deja tocar.
 *
 * Se renderiza a HTML con `renderToStaticMarkup` en lugar de montar un DOM
 * completo: lo que hay que comprobar es exactamente qué elementos salen —si
 * la categoría es un `<select>` o un texto, si está la columna Grupo, qué
 * acciones aparecen— y para eso el marcado basta y no hacen falta más
 * dependencias.
 *
 * Las Server Actions y el router se sustituyen porque los botones son
 * componentes de cliente: sin esto intentarían hablar con Supabase y con el
 * router de Next durante el render.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

vi.mock("@/app/actions", () => ({
  createMovement: async () => ({ ok: true }),
  updateMovement: async () => ({ ok: true }),
  deleteMovement: async () => ({ ok: true }),
  restoreMovement: async () => ({ ok: true }),
}));

const { TransactionsTable } = await import("./TransactionsTable");

function movement(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    bank: "BCP",
    operationType: "Consumo Tarjeta de Débito",
    transactionAt: "2026-08-15T19:30:00-05:00",
    amount: 120.5,
    merchant: "PEAJES CASETA P6",
    cardLast4: "3400",
    operationNumber: "123456",
    comment: "Ida al trabajo",
    category: "Transporte",
    summary: getSummaryForCategory("Transporte"),
    group: "GASTOS VARIABLES",
    origin: "EMAIL",
    deletedAt: null,
    ...overrides,
  };
}

/** HTML de la tabla con las opciones dadas. */
function render(props: Parameters<typeof TransactionsTable>[0]): string {
  return renderToStaticMarkup(<TransactionsTable {...props} />);
}

describe("categoría y grupo son solo texto", () => {
  it("la categoría NO es un desplegable", () => {
    const html = render({ transactions: [movement()], actions: "edit" });

    // Ni un solo <select> en toda la tabla: la categoría dejó de editarse aquí.
    expect(html).not.toContain("<select");
    expect(html).toContain("Transporte");
  });

  it("tampoco en el resumen, que además no tiene acciones", () => {
    const html = render({ transactions: [movement()], actions: "none" });

    expect(html).not.toContain("<select");
    expect(html).not.toContain("Editar");
    expect(html).not.toContain("Eliminar");
    expect(html).not.toContain("Acciones");
  });

  it("muestra la columna Grupo con el grupo de la categoría", () => {
    const html = render({ transactions: [movement()], actions: "none" });

    expect(html).toContain(">Grupo<");
    expect(html).toContain("GASTOS VARIABLES");
  });

  it("cada categoría trae su grupo", () => {
    const html = render({
      transactions: [
        movement({ id: "1", category: "Suscripciones", group: "GASTOS FIJOS" }),
        movement({ id: "2", category: "Ingresos", group: "INGRESOS" }),
      ],
      actions: "none",
    });

    expect(html).toContain("Suscripciones");
    expect(html).toContain("GASTOS FIJOS");
    expect(html).toContain("Ingresos");
    expect(html).toContain("INGRESOS");
  });

  it("sin categoría no inventa grupo", () => {
    const html = render({
      transactions: [movement({ category: null, group: null })],
      actions: "none",
    });

    expect(html).toContain("Sin categoría");
    expect(html).not.toContain("GASTOS");
    expect(html).not.toContain("INGRESOS");
  });

  it("mantiene el resto de columnas acordadas", () => {
    const html = render({ transactions: [movement()], actions: "edit" });

    for (const heading of [
      "Fecha",
      "Hora",
      "Movimiento",
      "Categoría resumen",
      "Categoría",
      "Grupo",
      "Tipo",
      "Tarjeta",
      "N° operación",
      "Comentario",
      "Origen",
      "Monto",
      "Acciones",
    ]) {
      expect(html).toContain(`>${heading}<`);
    }
  });
});

describe("acciones según la pantalla", () => {
  it("en Movimientos se puede editar y eliminar", () => {
    const html = render({ transactions: [movement()], actions: "edit" });

    expect(html).toContain("Editar");
    expect(html).toContain("Eliminar");
    expect(html).not.toContain("Restaurar");
  });

  it("en Eliminados solo se puede restaurar", () => {
    const html = render({
      transactions: [movement({ deletedAt: "2026-08-20T10:30:00-05:00" })],
      actions: "restore",
    });

    expect(html).toContain("Restaurar");
    // Un movimiento dado de baja no se edita: primero se restaura.
    expect(html).not.toContain(">Editar<");
    expect(html).not.toContain(">Eliminar<");
  });

  it("Eliminados muestra cuándo se dio de baja", () => {
    const html = render({
      transactions: [movement({ deletedAt: "2026-08-20T10:30:00-05:00" })],
      actions: "restore",
    });

    expect(html).toContain("Eliminado el");
    expect(html).toContain("20 Ago 2026");
    expect(html).toContain("10:30");
  });

  it("la columna «Eliminado el» no aparece en las demás pantallas", () => {
    const html = render({ transactions: [movement()], actions: "edit" });
    expect(html).not.toContain("Eliminado el");
  });
});

describe("lista vacía", () => {
  it("la papelera vacía no invita a esperar correos", () => {
    const html = render({
      transactions: [],
      actions: "restore",
      emptyMessage: "No hay movimientos eliminados.",
    });

    expect(html).toContain("No hay movimientos eliminados.");
    expect(html).not.toContain("correo del BCP");
  });

  it("la lista vacía normal sí", () => {
    const html = render({ transactions: [], actions: "edit" });
    expect(html).toContain("correo del BCP");
  });
});

describe("ancho en escritorio", () => {
  // El problema que resuelve esto: la tabla se enciende a 1024 px y el
  // contenedor topaba en esos mismos 1024 px, así que SIEMPRE sobraba tabla y
  // siempre había barra de desplazamiento horizontal.
  it("la tabla reparte el ancho en vez de estirarse con el contenido", () => {
    const html = render({ transactions: [movement()], actions: "edit" });

    // Sin `table-fixed`, las columnas crecen con su texto y desbordan; además
    // `truncate` no funciona dentro de una celda.
    expect(html).toContain("table-fixed");

    // Suelo por debajo del cual los valores se tocarían. Es lo que hace
    // aparecer la barra horizontal en el Resumen, que va en un contenedor
    // estrecho, y lo que la mantiene fuera de Movimientos, que va en uno ancho.
    expect(html).toContain("min-w-[88rem]");
  });

  it("cada columna declara su ancho una sola vez, en la cabecera", () => {
    const html = render({ transactions: [movement()], actions: "edit" });
    const cabeceras = html.slice(html.indexOf("<thead"), html.indexOf("</thead>"));

    // Con `table-fixed` las celdas heredan el ancho de su cabecera, así que
    // declararlo aquí es lo que garantiza que encabezado y valores no puedan
    // desalinearse.
    for (const ancho of ["w-[9%]", "w-[8%]", "w-[6%]"]) {
      expect(cabeceras).toContain(ancho);
    }

    // Y suman 100: si no, table-fixed reparte el sobrante o el faltante de
    // formas poco intuitivas.
    const suma = [...cabeceras.matchAll(/w-\[(\d+)%\]/g)].reduce(
      (total, m) => total + Number(m[1]),
      0,
    );
    expect(suma).toBe(100);
  });

  it("el texto largo se recorta con su contenido completo en el tooltip", () => {
    const largo = "TRANSFERENCIA INTERBANCARIA A UN COMERCIO DE NOMBRE MUY LARGO";
    const html = render({
      transactions: [movement({ merchant: largo, comment: largo })],
      actions: "edit",
    });

    expect(html).toContain("truncate");
    // Recortar visualmente no puede perder el dato: va en el `title`.
    expect(html).toContain(`title="${largo}"`);
  });

  it("las columnas siguen cuadrando en las tres variantes", () => {
    // Si el número de `<th>` y de `<td>` se separase, `table-fixed` alinearía
    // los valores bajo la cabecera equivocada y nadie lo notaría a simple vista.
    for (const actions of ["edit", "restore", "none"] as const) {
      const html = render({
        transactions: [movement({ deletedAt: "2026-08-20T10:30:00-05:00" })],
        actions,
      });

      const cabeceras = (html.match(/<th /g) ?? []).length;
      const cuerpo = html.slice(html.indexOf("<tbody"));
      const celdas = (cuerpo.match(/<td /g) ?? []).length;

      expect(celdas).toBe(cabeceras);
    }
  });

  it("el grupo puede partirse en dos líneas antes que recortarse", () => {
    // En la columna estrecha de la tabla, «GASTOS VARIABLES» tiene que caber
    // como sea. Pero el permiso va limitado a `lg`: el badge lo comparten las
    // tarjetas de móvil, que no deben cambiar.
    const html = render({ transactions: [movement()], actions: "edit" });

    expect(html).toContain("whitespace-nowrap lg:whitespace-normal");
  });
});

describe("el móvil no cambia", () => {
  it("las tarjetas siguen siendo el único bloque visible bajo lg", () => {
    const html = render({ transactions: [movement()], actions: "edit" });

    // La lista se oculta a partir de lg y la tabla solo aparece a partir de lg.
    expect(html).toContain('<ul class="space-y-2 lg:hidden">');
    expect(html).toContain("lg:block");
  });

  it("la tarjeta conserva sus datos", () => {
    const html = render({ transactions: [movement()], actions: "edit" });
    const tarjetas = html.slice(0, html.indexOf("lg:block"));

    // El importe se compara con el propio formateador: `Intl` mete un espacio
    // duro tras «S/», así que escribirlo a mano nunca coincidiría.
    for (const dato of [
      "PEAJES CASETA P6",
      formatCurrency(120.5),
      "Transporte",
      "GASTOS VARIABLES",
    ]) {
      expect(tarjetas).toContain(dato);
    }
  });
});

describe("cabecera «Monto» ordenable", () => {
  const hrefs = {
    recientes: "/movimientos",
    antiguos: "/movimientos?orden=antiguos",
    "monto-desc": "/movimientos?orden=monto-desc",
    "monto-asc": "/movimientos?orden=monto-asc",
  } as const;

  it("sin la prop, la cabecera es texto y nada cambia", () => {
    // Es el caso del Resumen y de Eliminados.
    const html = render({ transactions: [movement()], actions: "none" });

    expect(html).toContain(">Monto<");
    expect(html).not.toContain("Ordenar monto");
  });

  it("en el orden por defecto no muestra flecha", () => {
    const html = render({
      transactions: [movement()],
      actions: "edit",
      amountSort: { current: "recientes", hrefs },
    });

    expect(html).not.toContain("↓");
    expect(html).not.toContain("↑");
    // Y no dice estar ordenada por esta columna.
    expect(html).not.toContain("aria-sort");
  });

  it("el primer clic lleva a mayor monto", () => {
    const html = render({
      transactions: [movement()],
      actions: "edit",
      amountSort: { current: "recientes", hrefs },
    });

    expect(html).toContain('href="/movimientos?orden=monto-desc"');
    expect(html).toContain('aria-label="Ordenar monto de mayor a menor"');
  });

  it("ordenada de mayor a menor: flecha abajo y el clic invierte", () => {
    const html = render({
      transactions: [movement()],
      actions: "edit",
      amountSort: { current: "monto-desc", hrefs },
    });

    expect(html).toContain("↓");
    expect(html).toContain('href="/movimientos?orden=monto-asc"');
    expect(html).toContain('aria-label="Ordenar monto de menor a mayor"');
    expect(html).toContain('aria-sort="descending"');
  });

  it("ordenada de menor a mayor: flecha arriba", () => {
    const html = render({
      transactions: [movement()],
      actions: "edit",
      amountSort: { current: "monto-asc", hrefs },
    });

    expect(html).toContain("↑");
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain('href="/movimientos?orden=monto-desc"');
  });

  it("los enlaces conservan los filtros que hubiera", () => {
    const conFiltros = {
      ...hrefs,
      "monto-desc": "/movimientos?mes=2026-08&categoria=Delivery&orden=monto-desc",
    };

    const html = render({
      transactions: [movement()],
      actions: "edit",
      amountSort: { current: "recientes", hrefs: conFiltros },
    });

    expect(html).toContain("mes=2026-08");
    expect(html).toContain("categoria=Delivery");
  });

  it("las tarjetas de móvil no cambian por esto", () => {
    const conOrden = render({
      transactions: [movement()],
      actions: "edit",
      amountSort: { current: "monto-desc", hrefs },
    });
    const sinOrden = render({ transactions: [movement()], actions: "edit" });

    const tarjetas = (html: string) => html.slice(0, html.indexOf("lg:block"));
    expect(tarjetas(conOrden)).toBe(tarjetas(sinOrden));
  });
});
