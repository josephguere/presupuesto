import { createSupabaseClient } from "./client";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase con `service_role`. **Solo servidor.**
 *
 * Nunca importes este módulo desde un Client Component: la key bypassea RLS y
 * acabaría en el bundle del navegador. La protección real es que la variable no
 * lleva el prefijo `NEXT_PUBLIC_`, así que Next.js no la inlinea en el cliente;
 * esta nota es para que nadie la renombre por despiste.
 */

let cached: SupabaseClient | null = null;

/**
 * Devuelve el cliente admin, creándolo la primera vez.
 *
 * Es perezoso a propósito: si se resolviera al importar el módulo, `next build`
 * fallaría en cualquier máquina sin `.env.local`. Así el error aparece en la
 * petición que realmente necesita la base de datos, con un mensaje accionable.
 *
 * @throws Error si falta configuración. Los llamadores deben decidir si eso es
 *   un 500 (API) o un estado vacío con instrucciones (dashboard).
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing = [
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY",
  ].filter(Boolean);

  if (missing.length > 0) {
    // Solo el NOMBRE de la variable, nunca su valor.
    throw new Error(
      `Falta configuración de Supabase: ${missing.join(", ")}. ` +
        `Revisa tu .env.local (o las Environment Variables de Vercel).`,
    );
  }

  cached = createSupabaseClient(url!, serviceRoleKey!);
  return cached;
}

/** `true` si el entorno tiene lo necesario para hablar con Supabase. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
