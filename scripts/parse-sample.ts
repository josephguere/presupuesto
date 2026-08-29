/**
 * Prueba el parser del BCP contra un archivo de texto, sin Gmail ni Supabase.
 *
 * Uso:
 *   npm run parse:sample                       # usa samples/bcp-consumo.txt
 *   npm run parse:sample -- ruta/al/correo.txt
 *
 * Para probar con un correo REAL: abre el correo del BCP en Gmail →
 * "Mostrar original" → copia el texto plano a un .txt y pásalo como argumento.
 * Ese texto es exactamente lo que Apps Script envía con `getPlainBody()`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseBcpEmail } from "../lib/parsers/bcp";

const DEFAULT_SAMPLE = "samples/bcp-consumo.txt";
const filePath = resolve(process.cwd(), process.argv[2] ?? DEFAULT_SAMPLE);

let rawBody: string;
try {
  rawBody = readFileSync(filePath, "utf8");
} catch {
  console.error(`No se pudo leer el archivo: ${filePath}`);
  process.exit(1);
}

console.log(`Archivo:    ${filePath}`);
console.log(`Caracteres: ${rawBody.length}`);
console.log("-".repeat(60));

const result = parseBcpEmail(rawBody);

if (!result.ok) {
  console.error("PARSE_ERROR");
  console.error(`  código:  ${result.error.code}`);
  console.error(`  mensaje: ${result.error.message}`);
  if (result.error.missingFields?.length) {
    console.error(`  faltan:  ${result.error.missingFields.join(", ")}`);
  }
  process.exit(1);
}

console.log("OK — transacción extraída:\n");
console.table(result.data);
console.log("\nJSON:");
console.log(JSON.stringify(result.data, null, 2));
