import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
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
