import { isBcpEmail, parseBcpEmail } from "./bcp";
import { isYapeEmail, parseYapeEmail } from "./yape";
import type { ParseResult, ParsedTransaction } from "./types";

/**
 * Identificación del origen de un correo y despacho a su parser.
 *
 * Es la pieza que faltaba para que la ingesta admita más de una entidad:
 *
 *     Correo  →  identificar origen  →  parser del origen  →  normalización
 *                                                             común  →  Supabase
 *
 * Lo que cambia por proveedor es SOLO el parser: quién manda el correo y cómo
 * está escrito. Todo lo demás —guardar el correo crudo, deduplicar, convertir
 * divisa, insertar, registrar— es común y vive en el Route Handler, sin una
 * sola rama por banco.
 *
 * DOS FILTROS, Y LOS DOS HACEN FALTA:
 *
 *   · `senderDomains` responde «¿quién lo manda?». Barato y difícil de falsear,
 *     porque el remitente lo pone Gmail y no el cuerpo.
 *   · `matches` responde «¿de qué va?». Necesario porque un mismo remitente
 *     manda también publicidad, extractos y avisos de seguridad, y ninguno de
 *     esos es un movimiento.
 *
 * Exigir los dos es lo que impide que ampliar la búsqueda de Gmail para incluir
 * Yape acabe registrando correos que no son operaciones.
 *
 * Módulo puro: sin HTTP y sin base de datos.
 */

/** Identificador del proveedor. Es lo que acaba en `email_ingestions.source`. */
export type ProviderId = "BCP" | "YAPE";

export interface EmailProvider {
  id: ProviderId;
  /** Nombre legible, para logs y mensajes de error. */
  label: string;
  /**
   * Dominios (o direcciones) admitidos como remitente.
   *
   * Se compara por «contiene», igual que `isAllowedSender`: así un display name
   * distinto o un subdominio nuevo no rompen la ingesta.
   */
  senderDomains: string[];
  /** ¿El cuerpo es una notificación de operación de este proveedor? */
  matches: (rawBody: string) => boolean;
  parse: (rawBody: string) => ParseResult<ParsedTransaction>;
  /** Valor de `email_ingestions.source` y de `transactions.source`. */
  source: string;
}

/**
 * Los proveedores soportados.
 *
 * El orden es por volumen: los consumos del BCP son la mayoría del correo
 * diario. Como los remitentes no se solapan, el orden solo afecta a la
 * velocidad, nunca al resultado.
 */
export const PROVIDERS: readonly EmailProvider[] = [
  {
    id: "BCP",
    label: "BCP",
    senderDomains: ["notificacionesbcp.com.pe"],
    matches: isBcpEmail,
    parse: parseBcpEmail,
    source: "GMAIL_BCP",
  },
  {
    id: "YAPE",
    label: "Yape",
    senderDomains: ["yape.pe", "yape.com.pe"],
    matches: isYapeEmail,
    parse: parseYapeEmail,
    source: "GMAIL_YAPE",
  },
] as const;

/** Todos los dominios admitidos, para la lista blanca de remitentes. */
export function allProviderDomains(): string[] {
  return PROVIDERS.flatMap((provider) => provider.senderDomains);
}

/** ¿Viene este remitente de alguno de los proveedores conocidos? */
export function providerForSender(from: string): EmailProvider | null {
  const haystack = String(from ?? "").toLowerCase();

  return (
    PROVIDERS.find((provider) =>
      provider.senderDomains.some((domain) => haystack.includes(domain)),
    ) ?? null
  );
}

/**
 * A qué proveedor pertenece un correo.
 *
 * Se decide con el REMITENTE y el CUERPO a la vez. Si el remitente es conocido
 * pero el cuerpo no es una operación suya, devuelve `null`: es publicidad o un
 * aviso, y registrarlo como movimiento sería peor que ignorarlo.
 *
 * Sin remitente —al reprocesar un cuerpo suelto desde un script— se cae a
 * reconocer solo por contenido, que es lo que hacía la ingesta antes de que
 * hubiera más de un proveedor.
 */
export function identifyProvider(input: {
  from?: string | null;
  rawBody: string;
}): EmailProvider | null {
  const { from, rawBody } = input;

  if (from) {
    const bySender = providerForSender(from);
    // Remitente desconocido: no hay nada que intentar.
    if (!bySender) return null;
    return bySender.matches(rawBody) ? bySender : null;
  }

  return PROVIDERS.find((provider) => provider.matches(rawBody)) ?? null;
}

/**
 * Interpreta un correo de cualquier proveedor.
 *
 * Devuelve además QUÉ proveedor lo leyó, porque quien llama necesita saberlo
 * para etiquetar el correo crudo y el movimiento con el mismo `source`.
 */
export function parseProviderEmail(input: {
  from?: string | null;
  rawBody: string;
}): { provider: EmailProvider; result: ParseResult<ParsedTransaction> } | null {
  const provider = identifyProvider(input);
  if (!provider) return null;

  return { provider, result: provider.parse(input.rawBody) };
}
