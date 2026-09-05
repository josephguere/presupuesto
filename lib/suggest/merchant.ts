import { deaccent } from "@/lib/parsers/normalize";

/**
 * Normalización de nombres de comercio.
 *
 * El banco escribe el mismo comercio de muchas formas: con el prefijo de la
 * pasarela de pago, con el número del local delante, en mayúsculas o en mixto.
 * Para reconocer que dos apuntes son «lo mismo» hacen falta DOS claves, no una:
 *
 *   CANÓNICA  fiel — conserva sucursal y números.
 *             «DLC*PedidosYa KFC Qhatu P» → «PEDIDOSYA KFC QHATU P»
 *
 *   FAMILIA   agresiva — solo la marca.
 *             «DLC*PedidosYa KFC Qhatu P» → «PEDIDOSYA»
 *
 * Se buscan EN CASCADA y la canónica manda. Es lo que evita el error clásico de
 * agrupar de más: si «Yape Movilidad» tiene su propio historial, decide él, y no
 * se diluye en el cubo de todo lo que empieza por YAPE.
 *
 * La pasarela (`DLC*`, `EBN*`, `IZI*`, `EPC*`) se ELIMINA y nunca sirve para
 * agrupar. Si sirviera, «DLC*Temucom» y «DLC*UBER RIDES» acabarían en el mismo
 * cubo por compartir el procesador de pago, que no dice nada del negocio.
 */

/** Pasarelas de pago que el BCP antepone al comercio real. */
const GATEWAYS = new Set(["DLC", "EBN", "IZI", "EPC", "PAYU", "MP", "PP"]);

/** Prefijos que no dicen nada del comercio. */
const GENERIC_PREFIXES = ["PAGO DE", "PAGO", "COMPRA EN", "COMPRA", "CONSUMO EN", "CONSUMO"];

/** Palabras demasiado comunes para identificar una marca. */
const STOPWORDS = new Set([
  "SEDE",
  "LIMA",
  "PERU",
  "SUR",
  "NORTE",
  "ESTE",
  "OESTE",
  "REAL",
  "PLAZA",
  "MALL",
  "CENTRO",
  "TIENDA",
  "APP",
  "WEB",
  "CORP",
  "SANTA",
  "SAN",
  "DEL",
  "LOS",
  "LAS",
  "PARA",
  "POR",
  "CON",
  "SIN",
]);

/** Terminaciones societarias que no forman parte del nombre. */
const COMPANY_SUFFIX = /\b(S\s?A\s?C|S\s?A\s?A|SAC|SRL|S\s?A|EIRL|LTDA|INC|LLC|CORP)\b\.?$/;

/**
 * Forma canónica de un comercio.
 *
 * Mayúsculas, sin tildes, sin símbolos y sin espacios repetidos, con la pasarela
 * y el código de local fuera. Conserva la sucursal a propósito: dos locales de
 * la misma cadena pueden estar categorizados distinto y eso es información.
 */
export function normalizeMerchant(raw: string | null | undefined): string {
  if (!raw) return "";

  let value = deaccent(raw).toUpperCase();

  // Pasarela: «DLC*PedidosYa» → «PedidosYa». Se corta lo anterior al asterisco
  // solo si parece un prefijo de procesador, no si es parte del nombre.
  const star = value.indexOf("*");
  if (star > 0) {
    const head = value.slice(0, star).trim();
    if (GATEWAYS.has(head) || head.length <= 4) value = value.slice(star + 1);
  }

  // Símbolos fuera; los dígitos se conservan, que distinguen sucursales.
  value = value.replace(/[^A-Z0-9ÑÜ]+/g, " ").trim();

  // Código de local delante: «359 MAKRO SANTA ANITA» → «MAKRO SANTA ANITA».
  // Se exigen dos dígitos o más para no comerse un «7 SOPAS», donde el número
  // sí forma parte del nombre.
  value = value.replace(/^\d{2,}\s+/, "");

  for (const prefix of GENERIC_PREFIXES) {
    if (value.startsWith(`${prefix} `)) {
      value = value.slice(prefix.length + 1);
      break;
    }
  }

  value = value.replace(COMPANY_SUFFIX, "").trim();

  return value.replace(/\s+/g, " ").trim();
}

/**
 * Clave de familia: la marca, y nada más.
 *
 * El PRIMER token distintivo — cuatro letras o más, sin dígitos y fuera de la
 * lista de palabras comunes—, con la «S» final recortada para que «SOPAS» y
 * «SOPA» no sean dos marcas.
 *
 * Devuelve `""` cuando ningún token sirve. Eso es correcto y deliberado: sin
 * marca reconocible, mejor no agrupar que agrupar mal.
 */
export function merchantFamilyKey(raw: string | null | undefined): string {
  const canonical = normalizeMerchant(raw);
  if (!canonical) return "";

  for (const token of canonical.split(" ")) {
    if (token.length < 4) continue;
    if (/\d/.test(token)) continue;
    if (STOPWORDS.has(token)) continue;

    return token.length > 5 && token.endsWith("S") ? token.slice(0, -1) : token;
  }

  return "";
}
