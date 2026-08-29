/**
 * Vacía movimientos de la base de datos.
 *
 * Local y producción comparten la misma Supabase, así que este script distingue
 * por `is_test` para poder dejar producción a cero sin perder tus muestras
 * locales.
 *
 *   npm run db:clear                        simulacro: enseña qué se borraría
 *   npm run db:clear -- --confirm           borra los datos REALES (producción)
 *   npm run db:clear -- --test --confirm    borra los de prueba (local)
 *   npm run db:clear -- --all --confirm     borra todo
 *
 * Sin `--confirm` no toca nada. Es a propósito: un `delete` sin vuelta atrás no
 * debe estar a un tab de distancia en el historial de la terminal.
 *
 * Solo hace falta borrar de `email_ingestions`: la clave foránea de
 * `transactions` lleva ON DELETE CASCADE.
 *
 * Para que Apps Script vuelva a enviar los correos borrados, ejecuta después
 * `forgetSentIds()` en el editor de Apps Script — si no, los recuerda como ya
 * enviados y no los reenviará.
 */
import { Client } from "pg";
import { loadEnvLocal } from "./loadEnv";

type Scope = "real" | "test" | "all";

function resolveScope(): Scope {
  if (process.argv.includes("--all")) return "all";
  if (process.argv.includes("--test")) return "test";
  return "real";
}

/** Condición SQL de cada ámbito, y cómo se lee en castellano. */
const SCOPES: Record<Scope, { where: string; label: string }> = {
  real: { where: "is_test = false", label: "REALES (los que ve producción)" },
  test: { where: "is_test = true", label: "de PRUEBA (los que solo ves en local)" },
  all: { where: "true", label: "TODOS" },
};

async function main(): Promise<void> {
  loadEnvLocal();

  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error("Falta SUPABASE_DB_URL en .env.local. Ver README, sección 5.");
    process.exit(1);
  }

  const scope = resolveScope();
  const confirmed = process.argv.includes("--confirm");
  const { where, label } = SCOPES[scope];

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    // Siempre se mira antes de borrar, incluso con --confirm.
    const preview = await client.query<{
      gmail_message_id: string;
      merchant: string | null;
      amount: string | null;
      transaction_at: string | null;
    }>(`
      select e.gmail_message_id, t.merchant, t.amount, t.transaction_at
        from email_ingestions e
        left join transactions t on t.email_ingestion_id = e.id
       where e.${where}
       order by t.transaction_at nulls last
    `);

    console.log(`Movimientos ${label}: ${preview.rows.length}\n`);
    for (const row of preview.rows) {
      const fecha = row.transaction_at ? new Date(row.transaction_at).toISOString().slice(0, 10) : "—";
      console.log(
        `  ${fecha}  ${String(row.merchant ?? "—").padEnd(22)} ` +
          `${String(row.amount ?? "—").padStart(9)}   ${row.gmail_message_id}`,
      );
    }

    if (preview.rows.length === 0) {
      console.log("\nNada que borrar.");
      return;
    }

    if (!confirmed) {
      console.log(`\nSIMULACRO — no se ha borrado nada.`);
      console.log(`Para borrarlos de verdad:  npm run db:clear -- ${scopeFlag(scope)}--confirm`);
      return;
    }

    const deleted = await client.query(`delete from email_ingestions where ${where}`);
    console.log(`\nBorrados: ${deleted.rowCount} correos (y sus transacciones, por CASCADE).`);

    const left = await client.query<{ reales: string; prueba: string }>(`
      select count(*) filter (where is_test = false) as reales,
             count(*) filter (where is_test = true)  as prueba
        from transactions
    `);
    console.log(`\nQuedan · producción: ${left.rows[0].reales} · local: ${left.rows[0].prueba}`);

    if (scope !== "test") {
      console.log(
        "\nPara que Apps Script reenvíe los correos borrados, ejecuta allí `forgetSentIds()`.",
      );
    }
  } finally {
    await client.end();
  }
}

function scopeFlag(scope: Scope): string {
  return scope === "real" ? "" : `--${scope} `;
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
