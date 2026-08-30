import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Hash y verificación del PIN de acceso.
 *
 * El PIN **nunca** se guarda: en `AUTH_PIN_HASH` vive solo su derivación. Y el
 * hash nunca sale hacia el navegador — este módulo solo se importa desde código
 * de servidor (Route Handlers con `runtime = "nodejs"`).
 *
 * POR QUÉ SCRYPT Y NO BCRYPT. bcrypt no está en el proyecto y habría que añadir
 * una dependencia nativa; scrypt viene en `node:crypto`, es una función de
 * derivación pensada para contraseñas y además es *memory-hard*, así que resiste
 * mejor que bcrypt el crackeo con GPU. Cero dependencias nuevas para una
 * garantía igual o mejor.
 *
 * Con un PIN de 4 dígitos solo hay 10 000 combinaciones, así que el hash por sí
 * solo no basta: alguien con el hash en la mano lo rompe en segundos por mucho
 * scrypt que se use. La defensa de verdad es el bloqueo por intentos
 * (`lockout.ts`); esto protege el caso de que el valor de la variable se filtre.
 */

/** Coste de CPU/memoria. 16384 · 8 · 128 B ≈ 16 MB por derivación. */
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** Identificador del algoritmo, primero en el hash para poder migrarlo luego. */
const SCHEME = "scrypt";

/**
 * Separador de los campos del hash.
 *
 * Un punto, y no el `$` habitual de bcrypt, porque el valor vive en un `.env`:
 * Next expande las variables de esos ficheros, así que `scrypt$16384$8$1$...`
 * se leería como `scrypt` seguido del contenido de `$16384`, `$8` y `$1` —es
 * decir, nada— y el hash llegaría destrozado sin ningún aviso.
 *
 * Con punto y base64url el valor entero es `[A-Za-z0-9._-]`: atraviesa sin
 * tocarse un `.env`, el panel de Vercel y cualquier shell.
 */
const SEPARATOR = ".";

/** El PIN acordado: exactamente cuatro dígitos, nada más. */
const PIN_PATTERN = /^\d{4}$/;

/** ¿Tiene el PIN la forma correcta? No dice si es el correcto. */
export function isValidPinFormat(pin: unknown): pin is string {
  return typeof pin === "string" && PIN_PATTERN.test(pin);
}

/**
 * Deriva el valor que va en `AUTH_PIN_HASH`.
 *
 * Formato: `scrypt.16384.8.1.<sal>.<hash>`, en base64url. Los parámetros viajan
 * dentro para que subir el coste en el futuro no invalide los hashes ya
 * generados: se leen del propio valor, no de estas constantes.
 */
export function hashPin(pin: string): string {
  if (!isValidPinFormat(pin)) {
    throw new Error("El PIN debe tener exactamente 4 dígitos.");
  }

  const salt = randomBytes(SALT_LENGTH);
  const derived = scryptSync(pin, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
  });

  return [
    SCHEME,
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join(SEPARATOR);
}

/**
 * ¿Coincide el PIN con el hash configurado?
 *
 * Devuelve `false` ante cualquier problema —formato inválido, hash corrupto,
 * variable ausente— en lugar de lanzar: quien llama no debe poder distinguir
 * «PIN incorrecto» de «configuración rota» por la forma en que falla.
 */
export function verifyPin(pin: string, storedHash: string | undefined | null): boolean {
  if (!isValidPinFormat(pin) || !storedHash) return false;

  const parts = storedHash.split(SEPARATOR);
  if (parts.length !== 6 || parts[0] !== SCHEME) return false;

  const [, costRaw, blockSizeRaw, parallelizationRaw, saltRaw, expectedRaw] = parts;

  const cost = Number(costRaw);
  const blockSize = Number(blockSizeRaw);
  const parallelization = Number(parallelizationRaw);
  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelization)) {
    return false;
  }

  try {
    const salt = Buffer.from(saltRaw, "base64url");
    const expected = Buffer.from(expectedRaw, "base64url");
    if (salt.length === 0 || expected.length === 0) return false;

    const derived = scryptSync(pin, salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelization,
      // scrypt aborta si la derivación necesita más memoria de la permitida.
      maxmem: 256 * cost * blockSize,
    });

    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Valor configurado, o `null` si falta. Nunca se registra ni se devuelve. */
export function getConfiguredPinHash(): string | null {
  const hash = process.env.AUTH_PIN_HASH?.trim();
  return hash && hash.length > 0 ? hash : null;
}
