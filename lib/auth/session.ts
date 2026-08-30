/**
 * Sesión firmada, sin estado en servidor.
 *
 * La cookie lleva `payload.firma`, donde la firma es un HMAC-SHA256 del payload
 * con `AUTH_SESSION_SECRET`. No hay tabla de sesiones: el servidor no necesita
 * recordar nada para saber si una cookie es suya, y para un MVP de un usuario
 * eso ahorra una consulta por petición sin perder seguridad. Lo que NO da es
 * revocación remota — cerrar sesión borra la cookie de ESE navegador. Si algún
 * día hace falta invalidar todas a la vez, se rota el secreto.
 *
 * TODO ES WEB CRYPTO A PROPÓSITO. Este módulo lo usan el proxy (runtime
 * Edge) y los Route Handlers (Node). `node:crypto` no existe en Edge, así que
 * usar `crypto.subtle` es lo que permite tener UNA sola implementación de la
 * sesión en lugar de dos que podrían divergir.
 *
 * El PIN no entra aquí jamás: se verifica en `pin.ts` y lo único que sobrevive
 * es la fecha de expiración.
 */

/** Nombre de la cookie. Sin prefijo `NEXT_PUBLIC_`: no la lee el navegador. */
export const SESSION_COOKIE = "presupuesto_session";

/** Duración de la sesión: 30 días. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Longitud mínima del secreto.
 *
 * Un HMAC-SHA256 con una clave corta es adivinable sin conocer la cookie, así
 * que un secreto débil se trata como si no hubiera secreto: se rechaza.
 */
const MIN_SECRET_LENGTH = 32;

const encoder = new TextEncoder();

/** ¿Está la autenticación configurada y utilizable? */
export function getSessionSecret(): string | null {
  const secret = process.env.AUTH_SESSION_SECRET?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  return secret;
}

/* -------------------------------------------------------------------------- */
/* base64url                                                                   */
/* -------------------------------------------------------------------------- */

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Firma                                                                       */
/* -------------------------------------------------------------------------- */

async function sign(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/**
 * Comparación en tiempo constante.
 *
 * `timingSafeEqual` de `node:crypto` no existe en Edge, así que se recorre
 * siempre el buffer entero acumulando diferencias en vez de salir al primer
 * byte distinto. Sin esto, el tiempo de respuesta filtraría cuántos bytes de la
 * firma acertó quien la falsifica, y forjar una cookie pasaría a ser cuestión de
 * medir.
 */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* -------------------------------------------------------------------------- */
/* Emitir y verificar                                                          */
/* -------------------------------------------------------------------------- */

interface SessionPayload {
  /** Milisegundos epoch en que caduca. */
  exp: number;
  /** Emitida en. Solo informativo. */
  iat: number;
}

/** Crea el valor de la cookie. Devuelve `null` si falta configuración. */
export async function createSessionToken(
  secret: string,
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS,
  now: number = Date.now(),
): Promise<string> {
  const payload: SessionPayload = { iat: now, exp: now + maxAgeSeconds * 1000 };
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await sign(secret, encoded);

  return `${encoded}.${toBase64Url(signature)}`;
}

/**
 * ¿Es esta cookie una sesión válida y vigente?
 *
 * Devuelve un booleano y nada más: quien llama no puede equivocarse leyendo un
 * campo de más. Cualquier problema —firma falsa, formato roto, caducada— da el
 * mismo `false`, sin distinguir el motivo hacia fuera.
 */
export async function verifySessionToken(
  token: string | undefined | null,
  secret: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (!token) return false;

  const separator = token.indexOf(".");
  if (separator <= 0) return false;

  const encoded = token.slice(0, separator);
  const received = fromBase64Url(token.slice(separator + 1));
  if (!received) return false;

  const expected = await sign(secret, encoded);
  if (!equalBytes(received, expected)) return false;

  // La firma es nuestra: solo entonces tiene sentido leer el contenido.
  const raw = fromBase64Url(encoded);
  if (!raw) return false;

  try {
    const payload = JSON.parse(new TextDecoder().decode(raw)) as SessionPayload;
    return typeof payload.exp === "number" && payload.exp > now;
  } catch {
    return false;
  }
}

/** Atributos de la cookie de sesión, en un solo sitio para no descuadrarlos. */
export function sessionCookieOptions(maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    // En local el navegador rechazaría una cookie `Secure` sobre http.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
