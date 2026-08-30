import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPin } from "@/lib/auth/pin";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/**
 * Endpoint de acceso, con el contador de intentos en memoria.
 *
 * El doble replica la función `register_auth_attempt` de PostgreSQL —contar,
 * bloquear al quinto fallo y reiniciar cuando el bloqueo vence— porque es esa
 * lógica la que hay que probar, no la conexión a Supabase.
 *
 * El PIN de prueba es `4271` y se hashea de verdad con scrypt: nada de simular
 * la verificación, que es justo la pieza que no puede fallar.
 */

const PIN = "4271";
const SECRET = "un-secreto-de-al-menos-treinta-y-dos-caracteres";
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const state = vi.hoisted(() => ({
  failedCount: 0,
  lockedUntil: null as string | null,
  /** Fuerza un fallo de base de datos para comprobar que se cierra la puerta. */
  broken: false,
}));

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            state.broken
              ? Promise.resolve({ data: null, error: { message: "sin conexión" } })
              : Promise.resolve({ data: { locked_until: state.lockedUntil }, error: null }),
        }),
      }),
    }),
    // `rpc()` de supabase-js se espera directamente: devuelve una promesa.
    rpc: (_name: string, args: { p_success: boolean; p_max: number; p_lock_minutes: number }) => {
      if (state.broken) return Promise.resolve({ data: null, error: { message: "sin conexión" } });

      const now = Date.now();

      if (args.p_success) {
        state.failedCount = 0;
        state.lockedUntil = null;
      } else {
        const expired = state.lockedUntil !== null && Date.parse(state.lockedUntil) <= now;
        state.failedCount = expired ? 1 : state.failedCount + 1;
        state.lockedUntil = null;

        if (state.failedCount >= args.p_max) {
          state.lockedUntil = new Date(now + args.p_lock_minutes * 60_000).toISOString();
        }
      }

      return Promise.resolve({
        data: [{ failed_count: state.failedCount, locked_until: state.lockedUntil }],
        error: null,
      });
    },
  }),
}));

const { POST } = await import("./route");

function login(pin: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    }),
  );
}

/** Todo lo que el servidor imprimió durante el test. */
let logged: string[] = [];

beforeEach(() => {
  state.failedCount = 0;
  state.lockedUntil = null;
  state.broken = false;

  vi.stubEnv("AUTH_PIN_HASH", hashPin(PIN));
  vi.stubEnv("AUTH_SESSION_SECRET", SECRET);

  logged = [];
  const capture = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  vi.spyOn(console, "info").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});

describe("PIN correcto", () => {
  it("permite entrar y devuelve una sesión válida", async () => {
    const response = await login(PIN);

    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);

    const cookie = response.headers.get("set-cookie") ?? "";
    const token = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? "";

    expect(await verifySessionToken(decodeURIComponent(token), SECRET)).toBe(true);
  });

  it("la cookie es HttpOnly y de ámbito raíz", async () => {
    const cookie = (await login(PIN)).headers.get("set-cookie") ?? "";

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("SameSite=lax");
  });

  it("un acierto borra los fallos anteriores", async () => {
    await login("0000");
    await login("0000");
    await login(PIN);

    expect(state.failedCount).toBe(0);
  });
});

describe("PIN incorrecto", () => {
  it("no permite entrar y no entrega cookie", async () => {
    const response = await login("0000");

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("dice solo «Código incorrecto»", async () => {
    const body = await (await login("0000")).json();

    expect(body.message).toBe("Código incorrecto");
    // Ni intentos restantes, ni pistas de configuración, ni nada técnico.
    expect(JSON.stringify(body)).not.toMatch(/scrypt|hash|intentos restantes/i);
  });
});

describe("formato inválido", () => {
  it("rechaza longitudes distintas de 4", async () => {
    for (const pin of ["", "1", "123", "12345"]) {
      expect((await login(pin)).status).toBe(400);
    }
  });

  it("rechaza lo que no sean números", async () => {
    for (const pin of ["abcd", "12a4", "12 4", "-123"]) {
      expect((await login(pin)).status).toBe(400);
    }
  });

  it("rechaza tipos que no son texto", async () => {
    for (const pin of [1234, null, true, ["1", "2", "3", "4"]]) {
      expect((await login(pin)).status).toBe(400);
    }
  });

  it("un formato inválido NO gasta un intento", async () => {
    // Si contara, un fallo de la interfaz dejaría al usuario fuera 15 minutos.
    for (let i = 0; i < 20; i += 1) await login("abc");

    expect(state.failedCount).toBe(0);
    expect((await login(PIN)).status).toBe(200);
  });
});

describe("bloqueo por intentos", () => {
  it("al quinto fallo se bloquea", async () => {
    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) {
      expect((await login("0000")).status).toBe(401);
    }

    const fifth = await login("0000");
    expect(fifth.status).toBe(429);
    expect((await fifth.json()).message).toBe("Demasiados intentos. Intenta nuevamente más tarde.");
  });

  it("bloqueado, ni siquiera el PIN correcto entra", async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) await login("0000");

    const response = await login(PIN);

    expect(response.status).toBe(429);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("informa cuánto falta con Retry-After", async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) await login("0000");

    const retryAfter = Number((await login(PIN)).headers.get("retry-after"));

    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(LOCK_MINUTES * 60);
  });

  it("cuando el bloqueo vence, se puede volver a intentar", async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) await login("0000");
    expect((await login(PIN)).status).toBe(429);

    // El bloqueo caduca: es exactamente lo que ocurre al pasar los 15 minutos.
    state.lockedUntil = new Date(Date.now() - 1000).toISOString();

    expect((await login(PIN)).status).toBe(200);
  });

  it("tras el bloqueo, el contador vuelve a empezar", async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) await login("0000");
    state.lockedUntil = new Date(Date.now() - 1000).toISOString();

    await login("0000");

    expect(state.failedCount).toBe(1);
    expect(state.lockedUntil).toBeNull();
  });
});

describe("falta configuración o falla la base de datos", () => {
  it("sin AUTH_PIN_HASH no entra nadie", async () => {
    vi.stubEnv("AUTH_PIN_HASH", "");
    expect((await login(PIN)).status).toBe(503);
  });

  it("sin AUTH_SESSION_SECRET no entra nadie", async () => {
    vi.stubEnv("AUTH_SESSION_SECRET", "");
    expect((await login(PIN)).status).toBe(503);
  });

  it("si el contador no responde, se cierra la puerta", async () => {
    // Sin contador no hay freno a la fuerza bruta: tumbar la base de datos no
    // puede ser la forma de saltarse el límite de intentos.
    state.broken = true;

    const response = await login(PIN);

    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("el PIN nunca se filtra", () => {
  it("no aparece en ninguna respuesta", async () => {
    const cuerpos = [
      await (await login(PIN)).text(),
      await (await login("0000")).text(),
      await (await login("abc")).text(),
    ];

    for (const cuerpo of cuerpos) {
      expect(cuerpo).not.toContain(PIN);
      expect(cuerpo).not.toContain("0000");
    }
  });

  it("no aparece en los logs", async () => {
    await login(PIN);
    await login("0000");
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) await login("1111");

    const salida = logged.join("\n");

    expect(salida).not.toContain(PIN);
    expect(salida).not.toContain("0000");
    expect(salida).not.toContain("1111");
    // Y el hash tampoco.
    expect(salida).not.toContain("scrypt.");
  });

  it("no aparece en la cookie", async () => {
    const cookie = (await login(PIN)).headers.get("set-cookie") ?? "";
    expect(cookie).not.toContain(PIN);
  });
});
