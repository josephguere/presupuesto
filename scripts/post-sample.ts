/**
 * Envía un correo de prueba a /api/ingest/bcp, simulando a Google Apps Script.
 *
 * Uso (con `npm run dev` levantado en otra terminal):
 *
 *   npm run post:sample
 *   npm run post:sample -- --file samples/bcp-consumo.txt
 *   npm run post:sample -- --url https://tu-app.vercel.app/api/ingest/bcp
 *   npm run post:sample -- --id fake-msg-002        # otro Gmail Message ID
 *
 * Ejecutarlo DOS VECES con el mismo `--id` es la forma rápida de comprobar la
 * idempotencia: la primera responde PROCESSED y la segunda ALREADY_PROCESSED,
 * sin crear una segunda fila.
 *
 * Lee GMAIL_INGEST_KEY de .env.local (o del entorno).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvLocal } from "./loadEnv";

const DEFAULTS = {
  url: "http://localhost:3000/api/ingest/bcp",
  file: "samples/bcp-consumo.txt",
  id: "fake-msg-001",
  from: "Banco de Credito BCP <notificaciones@notificacionesbcp.com.pe>",
  to: "tu-correo@gmail.com",
  subject: "Realizaste un consumo con tu Tarjeta de Debito BCP",
};

/** Lee `--clave valor` de argv, con valor por defecto. */
function arg(name: keyof typeof DEFAULTS): string {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? (process.argv[index + 1] ?? DEFAULTS[name]) : DEFAULTS[name];
}

async function main(): Promise<void> {
  loadEnvLocal();

  const ingestKey = process.env.GMAIL_INGEST_KEY;
  if (!ingestKey) {
    console.error("Falta GMAIL_INGEST_KEY (defínela en .env.local o en el entorno).");
    process.exit(1);
  }

  const url = arg("url");
  const filePath = resolve(process.cwd(), arg("file"));
  const rawBody = readFileSync(filePath, "utf8");

  const payload = {
    gmailMessageId: arg("id"),
    gmailThreadId: `${arg("id")}-thread`,
    from: arg("from"),
    to: arg("to"),
    subject: arg("subject"),
    receivedAt: new Date().toISOString(),
    rawBody,
  };

  console.log(`POST ${url}`);
  console.log(`  gmailMessageId: ${payload.gmailMessageId}`);
  console.log(`  archivo:        ${filePath}`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ingest-key": ingestKey,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  console.log(`\nHTTP ${response.status}`);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }

  process.exit(response.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error("Fallo la petición:", error instanceof Error ? error.message : error);
  process.exit(1);
});
