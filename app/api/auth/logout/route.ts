import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { logger } from "@/lib/logger";

/**
 * POST /api/auth/logout — cierra la sesión.
 *
 * Solo POST. Si respondiera a GET, bastaría con que una página ajena incrustara
 * un `<img src="...">` para desconectarte cada vez que la visitaras.
 *
 * Se vacía la cookie y se le pone `Max-Age=0`, que es como se borra de verdad:
 * el navegador la descarta. Al ser una sesión firmada y sin estado, no hay nada
 * que invalidar en el servidor — el token deja de existir en el cliente y sin él
 * no se pasa del proxy.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });

  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });

  logger.info("auth.logout");
  return response;
}
