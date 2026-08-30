import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { hashPin, isValidPinFormat, verifyPin } from "./pin";
import {
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  getSessionSecret,
  sessionCookieOptions,
  verifySessionToken,
} from "./session";

/**
 * PIN y sesión.
 *
 * Son las dos piezas criptográficas del acceso y no tocan ni la base de datos ni
 * la red, así que se prueban directamente. El resto —bloqueo, endpoint,
 * proxy— vive en sus propios ficheros.
 */

const SECRET = "un-secreto-de-al-menos-treinta-y-dos-caracteres";

describe("formato del PIN", () => {
  it("acepta exactamente 4 dígitos", () => {
    for (const pin of ["0000", "1234", "9999", "0042"]) {
      expect(isValidPinFormat(pin)).toBe(true);
    }
  });

  it("rechaza cualquier otra longitud", () => {
    for (const pin of ["", "1", "123", "12345", "000000"]) {
      expect(isValidPinFormat(pin)).toBe(false);
    }
  });

  it("solo acepta números", () => {
    for (const pin of ["12a4", "abcd", "12 4", "1.34", "১২৩৪", "12-4", "+123"]) {
      expect(isValidPinFormat(pin)).toBe(false);
    }
  });

  it("no se deja engañar por espacios ni saltos de línea", () => {
    for (const pin of [" 1234", "1234 ", "12\n34", "1234\n"]) {
      expect(isValidPinFormat(pin)).toBe(false);
    }
  });
});

describe("hash del PIN", () => {
  const hash = hashPin("1234");

  it("el PIN correcto verifica", () => {
    expect(verifyPin("1234", hash)).toBe(true);
  });

  it("un PIN incorrecto no verifica", () => {
    for (const pin of ["1235", "4321", "0000", "9999"]) {
      expect(verifyPin(pin, hash)).toBe(false);
    }
  });

  it("el hash NO contiene el PIN", () => {
    // Lo esencial: quien lea la variable de entorno no ve el código.
    expect(hash).not.toContain("1234");
    expect(hash.startsWith("scrypt.")).toBe(true);
  });

  it("dos hashes del mismo PIN son distintos", () => {
    // Sal aleatoria: sin ella, un hash filtrado se compara contra una tabla.
    expect(hashPin("1234")).not.toBe(hashPin("1234"));
    expect(verifyPin("1234", hashPin("1234"))).toBe(true);
  });

  it("se niega a hashear algo que no sea un PIN válido", () => {
    expect(() => hashPin("abcd")).toThrow();
    expect(() => hashPin("12345")).toThrow();
  });

  it("un hash ausente o corrupto no verifica nunca", () => {
    for (const stored of [undefined, null, "", "no-es-un-hash", "scrypt.1.2.3", "bcrypt.x.y.z.w.v"]) {
      expect(verifyPin("1234", stored)).toBe(false);
    }
  });

  it("un formato de PIN inválido no verifica aunque el hash exista", () => {
    expect(verifyPin("abcd", hash)).toBe(false);
    expect(verifyPin("", hash)).toBe(false);
  });
});

describe("el hash sobrevive a un archivo .env", () => {
  // Aquí estuvo el fallo: el formato original usaba `$` como separador, igual
  // que bcrypt. Next expande las variables de los `.env`, así que
  // `scrypt$16384$8$1$...` se leía como `scrypt` seguido de tres variables
  // inexistentes, y el hash llegaba destrozado. Ningún PIN podía coincidir y el
  // único síntoma era «Código incorrecto».
  it("solo usa caracteres que ningún .env toca", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(hashPin("1234")).toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });

  it("se lee igual que se escribió, cargándolo como lo hace Next", () => {
    const hash = hashPin("1234");

    const dir = mkdtempSync(join(tmpdir(), "presupuesto-env-"));
    // `.env` y no `.env.local`: con NODE_ENV=test —el de Vitest— Next solo mira
    // `.env.test.local`, `.env.test` y `.env`. El expandido es el mismo.
    writeFileSync(join(dir, ".env"), `AUTH_PIN_HASH=${hash}
`);

    // El cuarto argumento fuerza la recarga: `loadEnvConfig` cachea el resultado
    // por proceso y sin esto devolvería el entorno de Vitest, no el del fichero.
    const { combinedEnv } = loadEnvConfig(dir, true, console, true);

    expect(combinedEnv.AUTH_PIN_HASH).toBe(hash);
    // Y lo que de verdad importa: el PIN sigue verificando tras el viaje.
    expect(verifyPin("1234", combinedEnv.AUTH_PIN_HASH)).toBe(true);
  });
});

describe("sesión firmada", () => {
  it("un token recién emitido es válido", async () => {
    const token = await createSessionToken(SECRET);
    expect(await verifySessionToken(token, SECRET)).toBe(true);
  });

  it("no vale con otro secreto", async () => {
    const token = await createSessionToken(SECRET);
    expect(await verifySessionToken(token, `${SECRET}-distinto`)).toBe(false);
  });

  it("caduca", async () => {
    const now = Date.now();
    const token = await createSessionToken(SECRET, 60, now);

    expect(await verifySessionToken(token, SECRET, now + 59_000)).toBe(true);
    expect(await verifySessionToken(token, SECRET, now + 61_000)).toBe(false);
  });

  it("dura 30 días por defecto", async () => {
    const now = Date.now();
    const token = await createSessionToken(SECRET, undefined, now);
    const treintaDias = 30 * 24 * 60 * 60 * 1000;

    expect(SESSION_MAX_AGE_SECONDS * 1000).toBe(treintaDias);
    expect(await verifySessionToken(token, SECRET, now + treintaDias - 1000)).toBe(true);
    expect(await verifySessionToken(token, SECRET, now + treintaDias + 1000)).toBe(false);
  });

  it("no se puede alargar la caducidad sin la firma", async () => {
    // El ataque evidente: cambiar `exp` por uno lejano y reenviar la cookie.
    const now = Date.now();
    const token = await createSessionToken(SECRET, 60, now);
    const [, signature] = token.split(".");

    const forjado = Buffer.from(JSON.stringify({ iat: now, exp: now + 10 ** 12 }))
      .toString("base64url");

    expect(await verifySessionToken(`${forjado}.${signature}`, SECRET)).toBe(false);
  });

  it("rechaza basura sin reventar", async () => {
    for (const token of [undefined, null, "", ".", "sinpunto", "a.b", "....", "%%%.%%%"]) {
      expect(await verifySessionToken(token, SECRET)).toBe(false);
    }
  });
});

describe("cookie de sesión", () => {
  it("es HttpOnly y no llega al JavaScript del navegador", () => {
    expect(sessionCookieOptions().httpOnly).toBe(true);
  });

  it("es SameSite y de ámbito raíz", () => {
    expect(sessionCookieOptions().sameSite).toBe("lax");
    expect(sessionCookieOptions().path).toBe("/");
  });

  it("Secure en producción, no en local", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookieOptions().secure).toBe(true);

    vi.stubEnv("NODE_ENV", "development");
    // En local el navegador rechazaría una cookie Secure sobre http.
    expect(sessionCookieOptions().secure).toBe(false);

    vi.unstubAllEnvs();
  });
});

describe("secreto de sesión", () => {
  beforeEach(() => vi.unstubAllEnvs());

  it("un secreto corto se trata como ausente", () => {
    vi.stubEnv("AUTH_SESSION_SECRET", "corto");
    expect(getSessionSecret()).toBeNull();
  });

  it("ausente es null", () => {
    vi.stubEnv("AUTH_SESSION_SECRET", "");
    expect(getSessionSecret()).toBeNull();
  });

  it("uno de 32 o más caracteres sirve", () => {
    vi.stubEnv("AUTH_SESSION_SECRET", SECRET);
    expect(getSessionSecret()).toBe(SECRET);
  });
});
