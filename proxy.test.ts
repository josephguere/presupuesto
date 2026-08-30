import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE, createSessionToken } from "@/lib/auth/session";
import { proxy } from "./proxy";

/**
 * La puerta de entrada.
 *
 * Lo que se comprueba aquí es la política, no la criptografía: qué rutas exigen
 * sesión, cuáles no y a dónde va cada redirección. Las cookies se firman de
 * verdad, así que un token manipulado falla como fallaría en producción.
 */

const SECRET = "un-secreto-de-al-menos-treinta-y-dos-caracteres";

/** Petición a una ruta, opcionalmente con cookie de sesión. */
function request(path: string, token?: string): NextRequest {
  const headers = new Headers();
  if (token !== undefined) headers.set("cookie", `${SESSION_COOKIE}=${token}`);

  return new NextRequest(new URL(path, "http://localhost:3000"), { headers });
}

/** `NextResponse.next()` se reconoce por esta cabecera interna. */
function pasa(response: Response): boolean {
  return response.headers.has("x-middleware-next");
}

function destino(response: Response): string | null {
  const location = response.headers.get("location");
  return location ? new URL(location).pathname + new URL(location).search : null;
}

let sesion: string;

beforeEach(async () => {
  vi.stubEnv("AUTH_SESSION_SECRET", SECRET);
  sesion = await createSessionToken(SECRET);
});

describe("rutas privadas sin sesión", () => {
  it("redirigen al login", async () => {
    for (const path of ["/", "/movimientos", "/eliminados"]) {
      const response = await proxy(request(path));

      expect(response.status).toBe(307);
      expect(destino(response)).toContain("/login");
    }
  });

  it("recuerdan a dónde iba el usuario", async () => {
    const response = await proxy(request("/movimientos?mes=2026-08"));

    expect(destino(response)).toBe("/login?next=%2Fmovimientos%3Fmes%3D2026-08");
  });

  it("una página nueva queda protegida sin tener que acordarse de nada", async () => {
    // Todo está cerrado por defecto: solo se abre lo que se lista explícitamente.
    const response = await proxy(request("/una-pantalla-que-aun-no-existe"));

    expect(response.status).toBe(307);
    expect(destino(response)).toContain("/login");
  });

  it("una cookie manipulada no sirve", async () => {
    for (const token of ["", "cualquier-cosa", `${sesion}x`, sesion.replace(/.$/, "A")]) {
      const response = await proxy(request("/movimientos", token));
      expect(response.status).toBe(307);
    }
  });

  it("una cookie firmada con otro secreto no sirve", async () => {
    const ajena = await createSessionToken("otro-secreto-de-treinta-y-dos-caracteres-largo");
    const response = await proxy(request("/movimientos", ajena));

    expect(response.status).toBe(307);
  });
});

describe("rutas privadas con sesión", () => {
  it("dejan pasar", async () => {
    for (const path of ["/", "/movimientos", "/eliminados"]) {
      expect(pasa(await proxy(request(path, sesion)))).toBe(true);
    }
  });

  it("una sesión caducada no pasa", async () => {
    const caducada = await createSessionToken(SECRET, 60, Date.now() - 120_000);
    expect((await proxy(request("/movimientos", caducada))).status).toBe(307);
  });
});

describe("pantalla de acceso", () => {
  it("se ve sin sesión", async () => {
    expect(pasa(await proxy(request("/login")))).toBe(true);
  });

  it("con sesión, devuelve al resumen", async () => {
    const response = await proxy(request("/login", sesion));

    expect(response.status).toBe(307);
    expect(destino(response)).toBe("/");
  });
});

describe("la ingesta no depende del login", () => {
  it("/api/ingest/bcp pasa sin cookie de sesión", async () => {
    // Apps Script no tiene navegador: exigirle la cookie rompería la ingesta.
    // Su autorización es la cabecera x-ingest-key, dentro del propio endpoint.
    expect(pasa(await proxy(request("/api/ingest/bcp")))).toBe(true);
  });

  it("tampoco le afecta una sesión caducada o falsa", async () => {
    expect(pasa(await proxy(request("/api/ingest/bcp", "basura")))).toBe(true);
  });

  it("el endpoint de acceso también es público, o no se podría entrar", async () => {
    expect(pasa(await proxy(request("/api/auth/login")))).toBe(true);
    expect(pasa(await proxy(request("/api/auth/logout")))).toBe(true);
  });
});

describe("después de cerrar sesión", () => {
  it("la cookie vacía ya no abre nada", async () => {
    // Es lo que deja el logout: la cookie con valor vacío y Max-Age=0.
    for (const path of ["/", "/movimientos", "/eliminados"]) {
      expect((await proxy(request(path, ""))).status).toBe(307);
    }
  });

  it("sin cookie tampoco", async () => {
    expect((await proxy(request("/movimientos"))).status).toBe(307);
  });
});

describe("sin configuración", () => {
  it("sin AUTH_SESSION_SECRET no pasa nadie", async () => {
    // Fallar cerrado: una configuración incompleta no puede abrir la aplicación.
    vi.stubEnv("AUTH_SESSION_SECRET", "");

    expect((await proxy(request("/movimientos", sesion))).status).toBe(307);
  });

  it("pero la ingesta sigue funcionando", async () => {
    vi.stubEnv("AUTH_SESSION_SECRET", "");

    expect(pasa(await proxy(request("/api/ingest/bcp")))).toBe(true);
  });
});
