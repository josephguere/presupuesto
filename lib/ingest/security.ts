import { createHash, timingSafeEqual } from "node:crypto";
import { deaccent } from "@/lib/parsers/normalize";
import { allProviderDomains } from "@/lib/parsers/providers";

/**
 * Reglas de admisión de la ingesta: quién puede llamar y qué correos aceptamos.
 *
 * Está separado del Route Handler para poder endurecerlo (o probarlo) sin tocar
 * la orquestación del endpoint.
 */

/** Cabecera con la clave compartida que envía Google Apps Script. */
export const INGEST_KEY_HEADER = "x-ingest-key";

/**
 * Remitentes admitidos por defecto.
 *
 * Salen del catálogo de proveedores, no de una lista escrita a mano: añadir un
 * proveedor en `lib/parsers/providers.ts` lo habilita aquí solo. Duplicar los
 * dominios permitiría que un proveedor tuviera parser pero no permiso de
 * entrada, y el síntoma sería un 403 desconcertante.
 */
function defaultAllowedSenders(): string[] {
  return allProviderDomains();
}

/**
 * Compara dos secretos en tiempo constante.
 *
 * Se comparan los hashes SHA-256, no las cadenas: así los buffers siempre miden
 * lo mismo (`timingSafeEqual` lanza si difieren en longitud) y de paso no se
 * filtra la longitud de la clave por el tiempo de respuesta.
 */
function secretsMatch(received: string, expected: string): boolean {
  const a = createHash("sha256").update(received, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export type AuthResult =
  | { ok: true }
  | { ok: false; reason: "NOT_CONFIGURED" | "MISSING_KEY" | "INVALID_KEY" };

/**
 * Valida la cabecera `x-ingest-key` contra `GMAIL_INGEST_KEY`.
 *
 * Si la variable no está configurada, se rechaza la petición. Un endpoint de
 * escritura abierto por olvido de configuración es mucho peor que uno caído.
 */
export function authorizeIngestRequest(request: Request): AuthResult {
  const expected = process.env.GMAIL_INGEST_KEY;
  if (!expected || expected.trim().length === 0) return { ok: false, reason: "NOT_CONFIGURED" };

  const received = request.headers.get(INGEST_KEY_HEADER);
  if (!received) return { ok: false, reason: "MISSING_KEY" };

  return secretsMatch(received, expected) ? { ok: true } : { ok: false, reason: "INVALID_KEY" };
}

/**
 * Extrae la dirección de un campo `From`.
 *
 * Gmail entrega `"BCP" <notificaciones@notificacionesbcp.com.pe>`, pero a veces
 * solo la dirección pelada. Se admiten ambas.
 */
export function extractEmailAddress(from: string): string {
  const angled = from.match(/<([^>]+)>/);
  return (angled?.[1] ?? from).trim().toLowerCase();
}

/**
 * Remitentes aceptados, configurables por entorno.
 *
 * OJO CON `BCP_ALLOWED_SENDERS`: si está configurada, SUSTITUYE por completo a
 * la lista por defecto. Una instalación que la tuviera puesta con solo el
 * dominio del BCP rechazaría los correos de Yape con un 403. El nombre de la
 * variable se conserva por compatibilidad con los despliegues ya existentes.
 */
export function getAllowedSenders(): string[] {
  const configured = process.env.BCP_ALLOWED_SENDERS;
  if (!configured) return defaultAllowedSenders();

  const parsed = configured
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  return parsed.length > 0 ? parsed : defaultAllowedSenders();
}

/**
 * ¿Viene el correo de un remitente que aceptamos?
 *
 * Se comprueba tanto la dirección extraída como el campo completo, porque el
 * criterio acordado es «el remitente CONTIENE» — así un display name distinto o
 * un subdominio nuevo del banco no rompen la ingesta.
 */
export function isAllowedSender(from: string): boolean {
  const haystack = from.toLowerCase();
  const address = extractEmailAddress(from);

  return getAllowedSenders().some(
    (allowed) => address === allowed || haystack.includes(allowed),
  );
}

/**
 * Filtro opcional por asunto. **Solo se aplica a los correos del BCP.**
 *
 * Vacío por defecto: el MVP valida por remitente + contenido. Cuando confirmes
 * el asunto real, basta con rellenar `BCP_SUBJECT_FILTER` — sin desplegar
 * código.
 *
 * Quien decide a qué proveedor se le aplica es `lib/ingest/pipeline.ts`. La
 * variable lleva el nombre del banco y contiene una frase suya, así que
 * aplicarla a Yape dejaría fuera todos sus correos sin ningún aviso.
 */
export function matchesSubjectFilter(subject: string | null | undefined): boolean {
  const filter = process.env.BCP_SUBJECT_FILTER?.trim();
  if (!filter) return true;

  return deaccent(subject ?? "").includes(deaccent(filter));
}
