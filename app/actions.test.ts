import { beforeEach, describe, expect, it, vi } from "vitest";
import { NO_CATEGORY } from "@/lib/categories";

/**
 * Pruebas del CRUD de movimientos.
 *
 * Una Server Action es un endpoint público que escribe con la `service_role`
 * key. Lo que se verifica aquí es doble:
 *
 *   · que crear, editar y eliminar hagan exactamente lo que dicen;
 *   · que nada inválido —ni un grupo enviado a mano— llegue a la base de datos.
 */

const state = vi.hoisted(() => ({
  inserts: [] as Record<string, unknown>[],
  updates: [] as Array<{ id: unknown; values: Record<string, unknown> }>,
  deletes: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({
    from: () => ({
      insert: (values: Record<string, unknown>) => {
        state.inserts.push(values);
        return {
          select: () => ({ single: () => Promise.resolve({ data: { id: VALID_ID }, error: null }) }),
        };
      },
      update: (values: Record<string, unknown>) => ({
        eq: (_column: string, id: unknown) => {
          state.updates.push({ id, values });
          return Promise.resolve({ error: null });
        },
      }),
      delete: () => ({
        eq: (_column: string, id: unknown) => {
          state.deletes.push(id);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** La sesión se controla por test: por defecto hay una válida. */
const auth = vi.hoisted(() => ({ session: true }));

vi.mock("@/lib/auth/guard", () => ({
  hasValidSession: async () => auth.session,
  SESSION_REQUIRED_MESSAGE: "Tu sesión expiró. Vuelve a ingresar tu código.",
}));

const { createMovement, updateMovement, deleteMovement, restoreMovement } = await import(
  "./actions"
);

const VALID_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

/** Formulario válido, con la posibilidad de romper un campo a la vez. */
function form(overrides: Record<string, string> = {}): FormData {
  const values: Record<string, string> = {
    date: "2026-08-29",
    time: "23:20",
    merchant: "PLAZA VEA",
    category: "Supermercado",
    operationType: "Consumo Tarjeta de Débito",
    cardLast4: "3400",
    amount: "50.00",
    operationNumber: "123456",
    comment: "Compra semanal",
    ...overrides,
  };

  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  auth.session = true;
  state.inserts = [];
  state.updates = [];
  state.deletes = [];
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createMovement", () => {
  it("guarda todos los campos del formulario", async () => {
    const result = await createMovement(form());

    expect(result.ok).toBe(true);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      transaction_at: "2026-08-29T23:20:00-05:00",
      merchant: "PLAZA VEA",
      category: "Supermercado",
      operation_type: "Consumo Tarjeta de Débito",
      card_last4: "3400",
      amount: 50,
      operation_number: "123456",
      comment: "Compra semanal",
    });
  });

  it("nace como MANUAL, en soles y sin correo asociado", async () => {
    await createMovement(form());

    expect(state.inserts[0]).toMatchObject({
      origin: "MANUAL",
      currency: "PEN",
      email_ingestion_id: null,
    });
  });

  it("no guarda ninguna columna de grupo", async () => {
    // El grupo se deriva al leer. Guardarlo permitiría que se desincronizara.
    await createMovement(form({ category: "Suscripciones" }));

    expect(state.inserts[0]).not.toHaveProperty("group");
    expect(state.inserts[0]).not.toHaveProperty("group_name");
  });

  it("ignora un grupo enviado a mano en el formulario", async () => {
    // Intento de colocar un gasto dentro de INGRESOS para falsear el balance.
    const formData = form({ category: "Restaurantes" });
    formData.set("group", "INGRESOS");

    await createMovement(formData);

    expect(state.inserts[0].category).toBe("Restaurantes");
    expect(JSON.stringify(state.inserts[0])).not.toContain("INGRESOS");
  });

  it("acepta los campos opcionales vacíos y los guarda como null", async () => {
    await createMovement(form({ cardLast4: "", operationNumber: "", comment: "" }));

    expect(state.inserts[0]).toMatchObject({
      card_last4: null,
      operation_number: null,
      comment: null,
    });
  });

  it("«Sin categoría» se guarda como null", async () => {
    await createMovement(form({ category: NO_CATEGORY }));
    expect(state.inserts[0].category).toBeNull();
  });
});

describe("createMovement — validación", () => {
  it("exige el movimiento", async () => {
    const result = await createMovement(form({ merchant: "   " }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.merchant).toBeTruthy();
    expect(state.inserts).toHaveLength(0);
  });

  it("exige un monto mayor que 0", async () => {
    for (const amount of ["0", "-5", "abc", ""]) {
      const result = await createMovement(form({ amount }));
      expect(result.ok).toBe(false);
    }
    expect(state.inserts).toHaveLength(0);
  });

  it("rechaza fechas y horas imposibles", async () => {
    expect((await createMovement(form({ date: "2026-02-31" }))).ok).toBe(false);
    expect((await createMovement(form({ date: "29/08/2026" }))).ok).toBe(false);
    expect((await createMovement(form({ time: "25:00" }))).ok).toBe(false);
    expect((await createMovement(form({ time: "11:20 PM" }))).ok).toBe(false);
    expect(state.inserts).toHaveLength(0);
  });

  it("rechaza una categoría inventada", async () => {
    const result = await createMovement(form({ category: "Cripto" }));
    expect(result.ok).toBe(false);
    expect(state.inserts).toHaveLength(0);
  });

  it("la tarjeta debe ser 4 dígitos o nada", async () => {
    expect((await createMovement(form({ cardLast4: "12" }))).ok).toBe(false);
    expect((await createMovement(form({ cardLast4: "abcd" }))).ok).toBe(false);
    expect((await createMovement(form({ cardLast4: "" }))).ok).toBe(true);
  });
});

describe("updateMovement", () => {
  it("actualiza el mismo registro, sin crear otro", async () => {
    const result = await updateMovement(VALID_ID, form({ merchant: "WONG", amount: "75.50" }));

    expect(result.ok).toBe(true);
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].id).toBe(VALID_ID);
    expect(state.updates[0].values).toMatchObject({ merchant: "WONG", amount: 75.5 });
  });

  it("nunca toca el origen ni el correo de procedencia", async () => {
    await updateMovement(VALID_ID, form());

    const values = state.updates[0].values;
    expect(values).not.toHaveProperty("origin");
    expect(values).not.toHaveProperty("email_ingestion_id");
    expect(values).not.toHaveProperty("original_amount");
    expect(values).not.toHaveProperty("exchange_rate");
  });

  it("cambiar la categoría recalcula el grupo sin guardarlo", async () => {
    await updateMovement(VALID_ID, form({ category: "Suscripciones" }));

    expect(state.updates[0].values.category).toBe("Suscripciones");
    expect(state.updates[0].values).not.toHaveProperty("group");
  });

  it("ignora un grupo enviado a mano al editar", async () => {
    // El formulario pinta el Grupo bloqueado y sin `name`, pero la Server Action
    // es un endpoint público: la garantía tiene que estar aquí, no en el HTML.
    const formData = form({ category: "Restaurantes" });
    formData.set("group", "INGRESOS");

    await updateMovement(VALID_ID, formData);

    expect(state.updates[0].values.category).toBe("Restaurantes");
    expect(JSON.stringify(state.updates[0].values)).not.toContain("INGRESOS");
  });

  it("editar no revive ni da de baja un movimiento", async () => {
    await updateMovement(VALID_ID, form());

    expect(state.updates[0].values).not.toHaveProperty("activo");
    expect(state.updates[0].values).not.toHaveProperty("eliminado_at");
  });

  it("rechaza un id que no es UUID", async () => {
    for (const id of ["1", "", "' or 1=1 --"]) {
      expect((await updateMovement(id, form())).ok).toBe(false);
    }
    expect(state.updates).toHaveLength(0);
  });
});

describe("deleteMovement — baja lógica", () => {
  it("desactiva el movimiento en lugar de borrarlo", async () => {
    const result = await deleteMovement(VALID_ID);

    expect(result.ok).toBe(true);
    // Lo que de verdad importa: NINGÚN delete llegó a la base de datos.
    expect(state.deletes).toHaveLength(0);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].id).toBe(VALID_ID);
    expect(state.updates[0].values.activo).toBe(false);
  });

  it("sella la fecha de baja", async () => {
    const antes = Date.now();
    await deleteMovement(VALID_ID);

    const eliminadoAt = state.updates[0].values.eliminado_at as string;
    expect(typeof eliminadoAt).toBe("string");
    expect(Date.parse(eliminadoAt)).toBeGreaterThanOrEqual(antes);
  });

  it("no toca ningún otro campo del movimiento", async () => {
    // Eliminar no debe perder el importe, la categoría ni el origen: son justo
    // los datos que «Restaurar» tiene que devolver intactos.
    await deleteMovement(VALID_ID);
    expect(Object.keys(state.updates[0].values).sort()).toEqual(["activo", "eliminado_at"]);
  });

  it("rechaza un id que no es UUID", async () => {
    expect((await deleteMovement("no-soy-uuid")).ok).toBe(false);
    expect(state.updates).toHaveLength(0);
    expect(state.deletes).toHaveLength(0);
  });
});

describe("restoreMovement", () => {
  it("reactiva el MISMO registro, sin insertar otro", async () => {
    const result = await restoreMovement(VALID_ID);

    expect(result.ok).toBe(true);
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].id).toBe(VALID_ID);
  });

  it("deja activo = true y limpia la fecha de baja", async () => {
    await restoreMovement(VALID_ID);

    expect(state.updates[0].values).toEqual({ activo: true, eliminado_at: null });
  });

  it("rechaza un id que no es UUID", async () => {
    for (const id of ["1", "", "' or 1=1 --"]) {
      expect((await restoreMovement(id)).ok).toBe(false);
    }
    expect(state.updates).toHaveLength(0);
  });
});

describe("eliminar y restaurar son reversibles", () => {
  it("el ciclo completo deja el movimiento como estaba", async () => {
    await deleteMovement(VALID_ID);
    await restoreMovement(VALID_ID);

    expect(state.updates.map((u) => u.values.activo)).toEqual([false, true]);
    expect(state.updates[1].values.eliminado_at).toBeNull();
    // Mismo id las dos veces: nunca se creó un registro nuevo.
    expect(new Set(state.updates.map((u) => u.id))).toEqual(new Set([VALID_ID]));
    expect(state.inserts).toHaveLength(0);
    expect(state.deletes).toHaveLength(0);
  });
});

describe("todas las acciones exigen sesión", () => {
  // Una Server Action es un endpoint público: quien conozca su identificador
  // puede invocarla sin pasar por ninguna página. Ocultar la interfaz no basta.
  beforeEach(() => {
    auth.session = false;
  });

  it("crear se rechaza sin sesión", async () => {
    const result = await createMovement(form());

    expect(result.ok).toBe(false);
    expect(state.inserts).toHaveLength(0);
  });

  it("editar se rechaza sin sesión", async () => {
    expect((await updateMovement(VALID_ID, form())).ok).toBe(false);
    expect(state.updates).toHaveLength(0);
  });

  it("eliminar se rechaza sin sesión", async () => {
    expect((await deleteMovement(VALID_ID)).ok).toBe(false);
    expect(state.updates).toHaveLength(0);
    expect(state.deletes).toHaveLength(0);
  });

  it("restaurar se rechaza sin sesión", async () => {
    expect((await restoreMovement(VALID_ID)).ok).toBe(false);
    expect(state.updates).toHaveLength(0);
  });

  it("la sesión se comprueba ANTES de validar nada", async () => {
    // Con datos perfectamente válidos sigue sin escribir: es autorización, no
    // un efecto secundario de que el formulario estuviera mal.
    const result = await createMovement(form({ merchant: "COMPRA LEGÍTIMA" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("sesión");
    expect(result.fieldErrors).toBeUndefined();
  });

  it("con sesión vuelven a funcionar", async () => {
    auth.session = true;

    expect((await createMovement(form())).ok).toBe(true);
    expect((await deleteMovement(VALID_ID)).ok).toBe(true);
    expect((await restoreMovement(VALID_ID)).ok).toBe(true);
  });
});
