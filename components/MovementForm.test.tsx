import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CATEGORIES, getGroupForCategory } from "@/lib/categories";
import type { Transaction } from "@/types/transaction";

/**
 * El formulario de crear y editar.
 *
 * Aquí sí hay que poder elegir la categoría —es la única pantalla donde se
 * cambia— y aquí es donde el Grupo tiene que verse pero no tocarse.
 *
 * Sobre el «cambia automáticamente»: el componente calcula el grupo en cada
 * render a partir de su estado de categoría, así que renderizarlo con una
 * categoría produce exactamente el mismo marcado que vería el usuario tras
 * elegirla en el desplegable. Por eso recorrer las categorías cubre la
 * actualización sin necesidad de simular el evento.
 */

vi.mock("@/app/actions", () => ({
  createMovement: async () => ({ ok: true }),
  updateMovement: async () => ({ ok: true }),
}));

const { MovementForm } = await import("./MovementForm");

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
    comment: null,
    category: "Transporte",
    group: "GASTOS VARIABLES",
    origin: "EMAIL",
    deletedAt: null,
    ...overrides,
  };
}

function render(transaction?: Transaction): string {
  return renderToStaticMarkup(
    <MovementForm transaction={transaction} onSaved={() => {}} onCancel={() => {}} />,
  );
}

describe("categoría", () => {
  it("al editar SÍ es un desplegable", () => {
    const html = render(movement());

    expect(html).toContain('<select name="category"');
    for (const category of CATEGORIES) {
      expect(html).toContain(`<option value="${category}"`);
    }
  });

  it("arranca con la categoría que tiene el movimiento", () => {
    const html = render(movement({ category: "Restaurantes" }));
    expect(html).toContain('<option value="Restaurantes" selected');
  });

  it("al crear arranca sin categoría", () => {
    const html = render();
    expect(html).toContain('<option value="__sin_categoria__" selected');
  });
});

describe("grupo", () => {
  it("se muestra, pero bloqueado", () => {
    const html = render(movement());

    expect(html).toContain('aria-label="Grupo del movimiento"');
    expect(html).toContain("disabled");
    expect(html).toContain('value="GASTOS VARIABLES"');
  });

  it("no se puede enviar: no tiene atributo name", () => {
    // Es la garantía en el navegador. La de verdad está en la Server Action,
    // que deriva el grupo de la categoría e ignora lo que llegue.
    const html = render(movement());

    expect(html).not.toContain('name="group"');
    expect(html).not.toContain('name="grupo"');
    expect(html).not.toContain("<select name=\"group\"");
  });

  it("cada categoría muestra su grupo", () => {
    for (const category of CATEGORIES) {
      const html = render(movement({ category }));
      const expected = getGroupForCategory(category);

      expect(html).toContain(`value="${expected}"`);
    }
  });

  it("los ejemplos acordados", () => {
    const casos = [
      ["Restaurantes", "GASTOS VARIABLES"],
      ["Transporte", "GASTOS VARIABLES"],
      ["Suscripciones", "GASTOS FIJOS"],
      ["Servicios", "GASTOS FIJOS"],
      ["Ingresos", "INGRESOS"],
    ] as const;

    for (const [category, group] of casos) {
      expect(render(movement({ category }))).toContain(`value="${group}"`);
    }
  });

  it("sin categoría, el grupo queda vacío", () => {
    const html = render(movement({ category: null, group: null }));

    expect(html).toContain('value="—"');
    expect(html).not.toContain("GASTOS");
    expect(html).not.toContain('value="INGRESOS"');
  });
});

describe("origen", () => {
  it("al editar se ve pero no se puede cambiar", () => {
    const html = render(movement({ origin: "EMAIL" }));

    expect(html).toContain("no se puede cambiar");
    expect(html).not.toContain('name="origin"');
  });

  it("al crear no se pregunta: nace MANUAL", () => {
    const html = render();

    expect(html).not.toContain('name="origin"');
    expect(html).not.toContain("no se puede cambiar");
  });
});

describe("campos editables", () => {
  it("están todos los acordados", () => {
    const html = render(movement());

    for (const name of [
      "date",
      "time",
      "merchant",
      "category",
      "operationType",
      "cardLast4",
      "amount",
      "operationNumber",
      "comment",
    ]) {
      expect(html).toContain(`name="${name}"`);
    }
  });

  it("no hay selector de moneda: todo va en soles", () => {
    const html = render(movement());

    expect(html).not.toContain('name="currency"');
    expect(html).toContain("Monto (S/)");
  });
});
