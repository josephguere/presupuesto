/**
 * Aplica `sql/init.sql` a la base de datos de Supabase y comprueba el resultado.
 *
 * Uso:
 *
 *   npm run db:init                    # lee SUPABASE_DB_URL de .env.local
 *   SUPABASE_DB_URL="..." npm run db:init
 *   npm run db:init -- --check         # solo verifica, no aplica nada
 *
 * Dónde sacar la cadena de conexión:
 *
 *   Supabase → botón **Connect** (arriba) → pestaña **Session pooler** → URI
 *
 * Usa el **Session pooler**, no el Transaction pooler: el pooler de transacciones
 * (puerto 6543) no es adecuado para DDL. La conexión directa también sirve, pero
 * en proyectos nuevos solo responde por IPv6, cosa que muchas redes domésticas no
 * tienen.
 *
 * El script es idempotente, igual que el SQL: ejecutarlo dos veces no rompe nada.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { loadEnvLocal } from "./loadEnv";

/** Lo que `sql/init.sql` tiene que haber dejado creado. */
const EXPECTED = {
  tables: ["email_ingestions", "transactions"],
  constraints: [
    "email_ingestions_gmail_message_id_key",
    "email_ingestions_processing_status_check",
    "transactions_email_ingestion_id_key",
    "transactions_email_ingestion_id_fkey",
  ],
  indexes: [
    "transactions_transaction_at_idx",
    "transactions_merchant_idx",
    "transactions_operation_number_idx",
    "email_ingestions_processing_status_idx",
  ],
};

/**
 * Oculta la contraseña antes de imprimir la cadena de conexión.
 * `postgresql://postgres.abc:SECRETO@host:5432/postgres` → `...:****@host...`
 */
function redact(connectionString: string): string {
  return connectionString.replace(/:\/\/([^:]+):[^@]+@/, "://$1:****@");
}

async function main(): Promise<void> {
  loadEnvLocal();

  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error(
      [
        "Falta SUPABASE_DB_URL.",
        "",
        "Supabase → botón Connect → pestaña 'Session pooler' → copia el URI",
        "y sustituye [YOUR-PASSWORD] por la contraseña de tu base de datos.",
        "",
        "Después añádela a .env.local:",
        "  SUPABASE_DB_URL=postgresql://postgres.tu-ref:CONTRASENA@aws-0-....pooler.supabase.com:5432/postgres",
      ].join("\n"),
    );
    process.exit(1);
  }

  const checkOnly = process.argv.includes("--check");

  const client = new Client({
    connectionString,
    // Supabase exige TLS. Sus certificados los firma una CA propia que no está
    // en el almacén de Node, así que se cifra sin validar la cadena.
    ssl: { rejectUnauthorized: false },
  });

  console.log(`Conectando a ${redact(connectionString)}`);
  await client.connect();

  try {
    if (!checkOnly) {
      const sqlPath = resolve(process.cwd(), "sql/init.sql");
      const sql = readFileSync(sqlPath, "utf8");

      console.log(`Ejecutando ${sqlPath} ...`);
      await client.query(sql);
      console.log("SQL aplicado.\n");
    }

    await verify(client);
  } finally {
    await client.end();
  }
}

/** Comprueba contra el catálogo de PostgreSQL que todo existe de verdad. */
async function verify(client: Client): Promise<void> {
  const tables = await queryNames(
    client,
    `select table_name as name
       from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );

  const constraints = await queryNames(
    client,
    `select conname as name
       from pg_constraint
      where connamespace = 'public'::regnamespace`,
  );

  const indexes = await queryNames(
    client,
    `select indexname as name from pg_indexes where schemaname = 'public'`,
  );

  const rls = await client.query<{ name: string; enabled: boolean }>(
    `select relname as name, relrowsecurity as enabled
       from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r'`,
  );

  let ok = true;

  ok = report("Tablas", EXPECTED.tables, tables) && ok;
  ok = report("Restricciones", EXPECTED.constraints, constraints) && ok;
  ok = report("Índices", EXPECTED.indexes, indexes) && ok;

  console.log("\nRow Level Security");
  for (const table of EXPECTED.tables) {
    const row = rls.rows.find((candidate) => candidate.name === table);
    const enabled = row?.enabled === true;
    if (!enabled) ok = false;
    console.log(`  ${enabled ? "OK  " : "FALTA"} ${table}${enabled ? "" : " (RLS desactivado)"}`);
  }

  // Cuántas filas hay ya, para saber si la ingesta está funcionando.
  const counts = await client.query<{ emails: string; transactions: string }>(
    `select (select count(*) from public.email_ingestions) as emails,
            (select count(*) from public.transactions)     as transactions`,
  );

  console.log("\nDatos actuales");
  console.log(`  email_ingestions: ${counts.rows[0].emails}`);
  console.log(`  transactions:     ${counts.rows[0].transactions}`);

  if (!ok) {
    console.error("\nFalta algo. Revisa el resultado de sql/init.sql en el SQL Editor.");
    process.exit(1);
  }

  console.log("\nEsquema correcto. Ya puedes lanzar la ingesta.");
}

async function queryNames(client: Client, sql: string): Promise<Set<string>> {
  const result = await client.query<{ name: string }>(sql);
  return new Set(result.rows.map((row) => row.name));
}

/** Imprime qué se esperaba y qué falta; devuelve `true` si está todo. */
function report(title: string, expected: string[], actual: Set<string>): boolean {
  console.log(title);
  let ok = true;

  for (const name of expected) {
    const present = actual.has(name);
    if (!present) ok = false;
    console.log(`  ${present ? "OK  " : "FALTA"} ${name}`);
  }

  return ok;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nError: ${message}`);

  if (/password authentication|SASL|SCRAM/i.test(message)) {
    console.error("La contraseña no es correcta. Puedes restablecerla en:");
    console.error("Supabase → Project Settings → Database → Reset database password");
  } else if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ENETUNREACH/i.test(message)) {
    console.error("No se pudo alcanzar el host. Usa la URI del 'Session pooler',");
    console.error("no la conexión directa: en proyectos nuevos esta solo responde por IPv6.");
  }

  process.exit(1);
});
