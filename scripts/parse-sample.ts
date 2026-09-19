/**
 * Prueba el parser de un correo contra un archivo de texto, sin Gmail ni
 * Supabase ni red. Es la forma segura de saber EXACTAMENTE qué se guardaría
 * (monto, fecha, comercio, comentario) antes de dejar que Apps Script lo
 * envíe de verdad a la base de datos.
 *
 * Uso:
 *   npm run parse:sample                       # usa samples/bcp-consumo.txt
 *   npm run parse:sample -- ruta/al/correo.txt
 *
 * Detecta el proveedor solo (BCP o Yape) con el mismo `identifyProvider` que
 * usa la API en producción, así que el resultado que ves aquí es idéntico al
 * que produciría `/api/ingest/email` — sin haber llamado a esa API ni una vez.
 *
 * Para probar con un correo REAL:
 *   1. Abre el correo en Gmail → ⋮ → "Mostrar original" → copia el texto
 *      plano a un .txt, o
 *   2. En Apps Script ejecuta `previewWindow(dias)` para localizarlo y copia
 *      su remitente/asunto, y usa `dumpEmailBody(dias)` para volcar su cuerpo
 *      completo en el Registro de ejecución y pegarlo en el .txt.
 * Ese texto es exactamente lo que Apps Script envía con `getPlainBody()`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseProviderEmail } from "../lib/parsers/providers";

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

// Sin remitente: se identifica solo por el contenido, igual que
// `identifyProvider` cuando no se le pasa `from`.
const dispatched = parseProviderEmail({ rawBody });

if (!dispatched) {
  console.error("NINGÚN PROVEEDOR reconoce este texto.");
  console.error("No es un BCP ni un Yape que el parser sepa leer.");
  process.exit(1);
}

console.log(`Proveedor detectado: ${dispatched.provider.label}`);
console.log("-".repeat(60));

const result = dispatched.result;

if (!result.ok) {
  console.error("PARSE_ERROR");
  console.error(`  código:  ${result.error.code}`);
  console.error(`  mensaje: ${result.error.message}`);
  if (result.error.missingFields?.length) {
    console.error(`  faltan:  ${result.error.missingFields.join(", ")}`);
  }
  process.exit(1);
}

console.log("OK — esto es EXACTAMENTE lo que se guardaría en `transactions`:");
console.log("");
console.table(result.data);
console.log("");
console.log("JSON:");
console.log(JSON.stringify(result.data, null, 2));
