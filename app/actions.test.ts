import { beforeEach, describe, expect, it, vi } from "vitest";
import { CATEGORIES, NO_CATEGORY } from "@/lib/categories";

/**
 * Tests de la Server Action de categorias.
 *
 * Una Server Action es un endpoint publico que escribe con la service_role key.
 * Lo que se verifica aqui es que NADA que no sea un UUID valido y una categoria
 * de la lista llegue a tocar la base de datos.
 */

const state = vi.hoisted(() => ({
  updates: [] as Array<{ id: unknown; values: Record<string, unknown> }>,
}));

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({
    from: () => ({
      update: (values: Record<string, unknown>) => ({
        eq: (_column: string, id: unknown) => {
          state.updates.push({ id, values });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { updateTransactionCategory } = await import("./actions");

const VALID_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

beforeEach(() => {
  state.updates = [];
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("updateTransactionCategory", () => {
  it("guarda una categoria de la lista", async () => {
    const result = await updateTransactionCategory(VALID_ID, "Supermercado");

    expect(result.ok).toBe(true);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toEqual({ id: VALID_ID, values: { category: "Supermercado" } });
  });

  it("acepta todas las categorias declaradas", async () => {
    for (const category of CATEGORIES) {
      expect((await updateTransactionCategory(VALID_ID, category)).ok).toBe(true);
    }
    expect(state.updates).toHaveLength(CATEGORIES.length);
  });

  it("guarda NULL cuando se quita la categoria", async () => {
    await updateTransactionCategory(VALID_ID, NO_CATEGORY);
    expect(state.updates[0].values).toEqual({ category: null });
  });

  it("rechaza categorias que no estan en la lista", async () => {
    const result = await updateTransactionCategory(VALID_ID, "Categoria Inventada");

    expect(result.ok).toBe(false);
    // Lo importante: no llego a la base de datos.
    expect(state.updates).toHaveLength(0);
  });

  it("rechaza un id que no es UUID", async () => {
    for (const id of ["1", "", "../../etc/passwd", "' or 1=1 --"]) {
      const result = await updateTransactionCategory(id, "Otros");
      expect(result.ok).toBe(false);
    }
    expect(state.updates).toHaveLength(0);
  });

  it("no deja pasar intentos de inyeccion en la categoria", async () => {
    for (const value of ["'; drop table transactions; --", "<script>alert(1)</script>", "null"]) {
      expect((await updateTransactionCategory(VALID_ID, value)).ok).toBe(false);
    }
    expect(state.updates).toHaveLength(0);
  });
});
