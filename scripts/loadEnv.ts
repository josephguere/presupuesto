import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Carga `.env.local` para los scripts de terminal.
 *
 * Next.js lo hace solo, pero estos scripts se ejecutan con `tsx`, fuera de
 * Next. Es un parser deliberadamente simple —líneas `CLAVE=valor`, comentarios
 * y comillas— no un sustituto de dotenv: solo lee un puñado de variables de
 * configuración local.
 *
 * El entorno real siempre gana, para poder hacer:
 *
 *     SUPABASE_DB_URL="..." npm run db:init
 */
export function loadEnvLocal(): void {
  let content: string;
  try {
    content = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return; // Sin .env.local: se usa lo que haya en el entorno.
  }

  for (const line of content.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key]) continue;

    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}
