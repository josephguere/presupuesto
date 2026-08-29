import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Pruebas del endpoint de ingesta, con una base de datos falsa en memoria.
 *
 * Lo que de verdad se valida aquí es la IDEMPOTENCIA: que el mismo Gmail Message
 * ID entre dos veces y no aparezcan duplicados. El doble replica las dos
 * restricciones UNIQUE reales (`gmail_message_id` y `email_ingestion_id`) y
 * devuelve el mismo código de error de PostgreSQL, 23505, para que la ruta pase
 * por la rama de conflicto de verdad y no por una simulada.
 */

const INGEST_KEY = "clave-de-prueba-solo-para-tests";
const BCP_SENDER = "Banco de Credito BCP <notificaciones@notificacionesbcp.com.pe>";

/** Estado compartido con el mock; `vi.hoisted` corre antes que los imports. */
const state = vi.hoisted(() => ({
  db: null as unknown as FakeDatabase,
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => state.db.client,
  isSupabaseConfigured: () => true,
}));

// Debe importarse DESPUÉS de declarar el mock.
const { POST } = await import("./route");

/* -------------------------------------------------------------------------- */
/* Base de datos falsa                                                         */
/* -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;

interface FakeDatabase {
  client: unknown;
  tables: Record<string, Row[]>;
}

/** Código de PostgreSQL para violación de restricción única. */
const PG_UNIQUE_VIOLATION = "23505";

function createFakeDatabase(): FakeDatabase {
  const tables: Record<string, Row[]> = { email_ingestions: [], transactions: [] };
  // Las mismas columnas UNIQUE que declara sql/init.sql.
  const uniqueColumns: Record<string, string[]> = {
    email_ingestions: ["gmail_message_id"],
    transactions: ["email_ingestion_id"],
  };

  let sequence = 0;

  function from(table: string) {
    const rows = tables[table];

    return {
      select() {
        const filters: Array<[string, unknown]> = [];
        const builder = {
          eq(column: string, value: unknown) {
            filters.push([column, value]);
            return builder;
          },
          maybeSingle() {
            const found = rows.find((row) => filters.every(([c, v]) => row[c] === v));
            return Promise.resolve({ data: found ?? null, error: null });
          },
        };
        return builder;
      },

      insert(values: Row) {
        const violated = uniqueColumns[table].find((column) =>
          rows.some((row) => row[column] === values[column]),
        );

        return {
          select: () => ({
            single: () => {
              if (violated) {
                return Promise.resolve({
                  data: null,
                  error: {
                    code: PG_UNIQUE_VIOLATION,
                    message: `duplicate key value violates unique constraint "${violated}"`,
                  },
                });
              }

              sequence += 1;
              const row: Row = { id: `${table}-${sequence}`, ...values };
              rows.push(row);
              return Promise.resolve({ data: row, error: null });
            },
          }),
        };
      },

      /** `ON CONFLICT (columna) DO UPDATE`: actualiza si existe, inserta si no. */
      upsert(values: Row, options: { onConflict: string }) {
        return {
          select: () => ({
            single: () => {
              const existing = rows.find(
                (row) => row[options.onConflict] === values[options.onConflict],
              );

              if (existing) {
                Object.assign(existing, values);
                return Promise.resolve({ data: existing, error: null });
              }

              sequence += 1;
              const row: Row = { id: `${table}-${sequence}`, ...values };
              rows.push(row);
              return Promise.resolve({ data: row, error: null });
            },
          }),
        };
      },

      update(values: Row) {
        return {
          eq(column: string, value: unknown) {
            for (const row of rows) {
              if (row[column] === value) Object.assign(row, values);
            }
            return Promise.resolve({ error: null });
          },
        };
      },
    };
  }

  return { client: { from }, tables };
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                  */
/* -------------------------------------------------------------------------- */

const SAMPLE_BODY = readFileSync(resolve(process.cwd(), "samples/bcp-consumo.txt"), "utf8");

function buildRequest(
  overrides: Partial<Record<string, unknown>> = {},
  options: { key?: string | null } = {},
): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  const key = options.key === undefined ? INGEST_KEY : options.key;
  if (key !== null) headers.set("x-ingest-key", key);

  return new Request("http://localhost/api/ingest/bcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      gmailMessageId: "gmail-msg-001",
      gmailThreadId: "gmail-thread-001",
      from: BCP_SENDER,
      to: "yo@gmail.com",
      subject: "Realizaste un consumo",
      receivedAt: "2026-08-26T23:28:00.000Z",
      rawBody: SAMPLE_BODY,
      ...overrides,
    }),
  });
}

beforeEach(() => {
  state.db = createFakeDatabase();
  vi.stubEnv("GMAIL_INGEST_KEY", INGEST_KEY);
  vi.stubEnv("BCP_ALLOWED_SENDERS", "");
  vi.stubEnv("BCP_SUBJECT_FILTER", "");
  // Los tests comprueban el comportamiento, no lo que se imprime.
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe("POST /api/ingest/bcp — camino feliz", () => {
  it("guarda el correo y la transacción del caso de aceptación", async () => {
    const response = await POST(buildRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: "PROCESSED" });

    expect(state.db.tables.email_ingestions).toHaveLength(1);
    expect(state.db.tables.transactions).toHaveLength(1);

    expect(state.db.tables.email_ingestions[0]).toMatchObject({
      gmail_message_id: "gmail-msg-001",
      sender_email: "notificaciones@notificacionesbcp.com.pe",
      processing_status: "PROCESSED",
      processing_error: null,
    });

    expect(state.db.tables.transactions[0]).toMatchObject({
      bank: "BCP",
      amount: 20,
      currency: "PEN",
      merchant: "YAPE",
      card_last4: "3400",
      operation_number: "539458",
      transaction_at: "2026-08-26T18:28:00-05:00",
      source: "GMAIL_BCP",
    });
  });

  it("guarda el cuerpo original íntegro, para poder reprocesarlo", async () => {
    await POST(buildRequest());
    expect(state.db.tables.email_ingestions[0].raw_body).toBe(SAMPLE_BODY);
  });
});

describe("POST /api/ingest/bcp — idempotencia", () => {
  it("el mismo Gmail Message ID no crea duplicados", async () => {
    const first = await (await POST(buildRequest())).json();
    const second = await (await POST(buildRequest())).json();
    const third = await (await POST(buildRequest())).json();

    expect(first.status).toBe("PROCESSED");
    expect(second.status).toBe("ALREADY_PROCESSED");
    expect(third.status).toBe("ALREADY_PROCESSED");

    // El criterio de aceptación: exactamente una fila en cada tabla.
    expect(state.db.tables.email_ingestions).toHaveLength(1);
    expect(state.db.tables.transactions).toHaveLength(1);

    // Y siempre se devuelven los mismos identificadores.
    expect(second.emailId).toBe(first.emailId);
    expect(second.transactionId).toBe(first.transactionId);
  });

  it("responde 200 al reenvío, no un error", async () => {
    await POST(buildRequest());
    const response = await POST(buildRequest());

    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });

  it("Gmail Message IDs distintos sí crean movimientos distintos", async () => {
    await POST(buildRequest({ gmailMessageId: "gmail-msg-001" }));
    await POST(buildRequest({ gmailMessageId: "gmail-msg-002" }));

    expect(state.db.tables.email_ingestions).toHaveLength(2);
    expect(state.db.tables.transactions).toHaveLength(2);
  });
});

describe("POST /api/ingest/bcp — correo ilegible", () => {
  const unparseable = "Realizaste un consumo, pero el resto del correo llegó vacío.";

  it("conserva el correo y lo marca PARSE_ERROR sin crear transacción", async () => {
    const response = await POST(buildRequest({ rawBody: unparseable }));
    const body = await response.json();

    // 200: el correo está guardado, reintentar no cambiaría nada.
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: false, status: "PARSE_ERROR" });

    expect(state.db.tables.transactions).toHaveLength(0);
    expect(state.db.tables.email_ingestions[0]).toMatchObject({
      processing_status: "PARSE_ERROR",
      raw_body: unparseable,
    });
    expect(state.db.tables.email_ingestions[0].processing_error).toEqual(expect.any(String));
  });

  it("reprocesa sobre la misma fila cuando el correo vuelve legible", async () => {
    // Simula el caso real: el parser falló, se corrigió y se reintenta.
    await POST(buildRequest({ rawBody: unparseable }));
    const retry = await (await POST(buildRequest())).json();

    expect(retry.status).toBe("PROCESSED");
    expect(state.db.tables.email_ingestions).toHaveLength(1);
    expect(state.db.tables.transactions).toHaveLength(1);
    expect(state.db.tables.email_ingestions[0]).toMatchObject({
      processing_status: "PROCESSED",
      processing_error: null,
      // El correo guardado es el que originó la transacción, no el intento viejo.
      raw_body: SAMPLE_BODY,
    });
  });
});

describe("POST /api/ingest/bcp — seguridad", () => {
  it("401 sin la cabecera x-ingest-key", async () => {
    const response = await POST(buildRequest({}, { key: null }));
    expect(response.status).toBe(401);
    expect(state.db.tables.email_ingestions).toHaveLength(0);
  });

  it("401 con una clave incorrecta", async () => {
    const response = await POST(buildRequest({}, { key: "clave-que-no-es" }));
    expect(response.status).toBe(401);
    expect(state.db.tables.email_ingestions).toHaveLength(0);
  });

  it("401 aunque la clave incorrecta tenga la longitud correcta", async () => {
    const response = await POST(buildRequest({}, { key: "x".repeat(INGEST_KEY.length) }));
    expect(response.status).toBe(401);
  });

  it("500 si GMAIL_INGEST_KEY no está configurada, nunca abierto", async () => {
    vi.stubEnv("GMAIL_INGEST_KEY", "");
    const response = await POST(buildRequest());

    expect(response.status).toBe(500);
    expect(state.db.tables.email_ingestions).toHaveLength(0);
  });

  it("403 si el remitente no es el del banco", async () => {
    const response = await POST(buildRequest({ from: "phisher@ejemplo.com" }));

    expect(response.status).toBe(403);
    expect(state.db.tables.email_ingestions).toHaveLength(0);
  });

  it("acepta el remitente del BCP con o sin nombre visible", async () => {
    const bare = await POST(
      buildRequest({ from: "notificaciones@notificacionesbcp.com.pe", gmailMessageId: "a" }),
    );
    expect(bare.status).toBe(200);

    const withName = await POST(buildRequest({ from: BCP_SENDER, gmailMessageId: "b" }));
    expect(withName.status).toBe(200);
  });

  it("respeta BCP_SUBJECT_FILTER cuando se configura", async () => {
    vi.stubEnv("BCP_SUBJECT_FILTER", "Tarjeta de Débito");

    const rejected = await POST(buildRequest({ subject: "Tu estado de cuenta" }));
    expect(rejected.status).toBe(403);

    // Sin tildes y en otra caja: debe aceptarse igual.
    const accepted = await POST(buildRequest({ subject: "CONSUMO CON TARJETA DE DEBITO BCP" }));
    expect(accepted.status).toBe(200);
  });
});

describe("POST /api/ingest/bcp — payload", () => {
  it("400 si el JSON está roto", async () => {
    const response = await POST(
      new Request("http://localhost/api/ingest/bcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingest-key": INGEST_KEY },
        body: "{roto",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("400 si faltan campos obligatorios", async () => {
    const response = await POST(buildRequest({ rawBody: undefined }));
    expect(response.status).toBe(400);
    expect(state.db.tables.email_ingestions).toHaveLength(0);
  });

  it("400 si receivedAt no es una fecha válida", async () => {
    const response = await POST(buildRequest({ receivedAt: "el martes pasado" }));
    expect(response.status).toBe(400);
  });

  it("400 si llega un campo desconocido", async () => {
    const response = await POST(buildRequest({ campoInventado: "sorpresa" }));
    expect(response.status).toBe(400);
  });
});
