import { handleIngestGet, handleIngestPost } from "@/lib/ingest/pipeline";

/**
 * POST /api/ingest/bcp — la misma ingesta, con el nombre antiguo.
 *
 * SE CONSERVA PARA NO ROMPER NADA. Cuando la ingesta solo entendía correos del
 * BCP, esta era la única ruta, y es la que está escrita en la propiedad
 * `API_URL` de los Apps Script ya configurados. Borrarla dejaría la ingesta
 * muerta hasta que alguien se acordara de ir a Google a cambiar la URL.
 *
 * No duplica nada: las dos rutas llaman al mismo `lib/ingest/pipeline.ts`, que
 * despacha por proveedor. Este endpoint acepta correos de Yape igual que el
 * canónico; el nombre es lo único que se quedó viejo.
 *
 * La ruta nueva es `/api/ingest/email`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handleIngestPost;

export function GET(request: Request) {
  return handleIngestGet(request, "/api/ingest/bcp");
}
