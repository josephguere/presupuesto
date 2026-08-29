import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Fábrica compartida de clientes Supabase.
 *
 * Este módulo NO contiene ni lee secretos: recibe la key como argumento. Existe
 * para que todos los clientes del proyecto compartan la misma configuración
 * (DRY) y para que `server.ts` sea el único lugar donde vive la service role.
 *
 * Nota sobre la anon key: este MVP no la usa. El dashboard son Server
 * Components que leen desde el servidor, y Google Apps Script habla con nuestra
 * API, no con Supabase. Introducir una anon key obligaría a diseñar policies de
 * RLS públicas sin aportar nada al MVP, así que se omite a propósito.
 *
 * Cuando llegue el momento de leer desde el navegador (realtime, filtros
 * client-side), aquí se añade `createBrowserSupabaseClient()` usando
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` + policies de RLS.
 */
export function createSupabaseClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: {
      // No hay sesiones de usuario en el MVP: nada que persistir ni refrescar.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
