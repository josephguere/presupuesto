import { handleIngestGet, handleIngestPost } from "@/lib/ingest/pipeline";

/**
 * POST /api/ingest/email — punto de entrada de los correos de banco.
 *
 * Es la ruta CANÓNICA de la ingesta. Sirve a todos los proveedores —BCP, Yape y
 * los que vengan—, porque quien decide qué parser usa cada correo es
 * `lib/parsers/providers.ts`, no la URL.
 *
 * Toda la lógica vive en `lib/ingest/pipeline.ts`. Aquí solo se declara el
 * runtime, porque `/api/ingest/bcp` sirve exactamente lo mismo y no puede ser
 * una copia.
 */

// El endpoint usa node:crypto y escribe en base de datos: nada que cachear.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handleIngestPost;

export function GET(request: Request) {
  return handleIngestGet(request, "/api/ingest/email");
}
