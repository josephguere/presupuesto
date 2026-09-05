import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { hasValidSession } from "@/lib/auth/guard";
import { getGroupForCategory, getSummaryForCategory } from "@/lib/categories";
import { pickFromHistory, type HistoryRow } from "@/lib/suggest/history";
import { redactComment, redactMerchant } from "@/lib/suggest/redact";
import { isGeminiConfigured, suggestWithGemini } from "@/lib/suggest/gemini";
import { shouldShowTestData } from "@/lib/environment";
import { describeError, logger } from "@/lib/logger";

/**
 * POST /api/transactions/suggest-category — propone una categoría.
 *
 * SOLO PROPONE. No escribe absolutamente nada: devuelve una sugerencia y el
 * usuario decide en el formulario. Por eso este endpoint no puede, ni por error
 * ni por inyección, modificar un movimiento.
 *
 * El orden importa y es el barato primero:
 *
 *   1. El historial del propio usuario. Gratis, instantáneo y mejor informado
 *      que cualquier modelo: nadie conoce sus gastos como él.
 *   2. Gemini, solo si el historial no alcanza.
 *   3. Nada, y el usuario elige a mano.
 *
 * El cuerpo trae únicamente el `transactionId`. El comercio, el importe y el
 * comentario se leen aquí desde la base de datos: si los enviara el cliente,
 * este endpoint clasificaría texto arbitrario a cuenta del usuario.
 */

// El SDK de Gemini y Supabase necesitan Node; y esto no se cachea nunca.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tope de historial que se trae. Con 117 movimientos sobra; con 10.000 también. */
const HISTORY_LIMIT = 1000;

/** Ejemplos que se le enseñan a Gemini para que copie el criterio del usuario. */
const MAX_EXAMPLES = 10;

const BodySchema = z.object({ transactionId: z.string().uuid() }).strict();

interface TransactionRow {
  id: string;
  merchant: string | null;
  comment: string | null;
  operation_type: string | null;
  amount: string | number | null;
  category: string | null;
}

export async function POST(request: Request): Promise<NextResponse> {
  // Lo primero, antes de leer el cuerpo y antes de tocar Supabase: sin sesión,
  // esto leería movimientos ajenos para quien conociera un id.
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Falta configuración." }, { status: 503 });
  }

  let transactionId: string;
  try {
    ({ transactionId } = BodySchema.parse(await request.json()));
  } catch {
    return NextResponse.json({ error: "Petición no válida." }, { status: 400 });
  }

  try {
    const movement = await findTransaction(transactionId);
    if (!movement) {
      return NextResponse.json({ error: "Movimiento no encontrado." }, { status: 404 });
    }

    const history = await loadHistory();

    // ---- 1. El historial del usuario ---------------------------------------
    const match = pickFromHistory(movement.merchant, history);

    if (match) {
      logger.info("suggest.history", { level: match.level, matches: match.matches });
      return NextResponse.json(
        buildResponse(match.category, "history", match.matches, reasonForHistory(match)),
      );
    }

    // ---- 2. Gemini ----------------------------------------------------------
    if (!isGeminiConfigured()) {
      logger.info("suggest.none", { reason: "sin historial y sin GEMINI_API_KEY" });
      return NextResponse.json(buildResponse(null, "none", 0, null));
    }

    const merchant = redactMerchant(movement.merchant);
    const suggestion = await suggestWithGemini({
      merchant,
      operationType: movement.operation_type,
      comment: redactComment(movement.comment),
      amount: Number(movement.amount ?? 0),
      examples: buildExamples(history),
    });

    if (!suggestion) {
      logger.info("suggest.none", { reason: "gemini sin respuesta util" });
      return NextResponse.json(buildResponse(null, "none", 0, null));
    }

    logger.info("suggest.gemini", { category: suggestion });
    return NextResponse.json(
      buildResponse(suggestion, "gemini", 0, `Sugerida por Gemini a partir de «${merchant}»`),
    );
  } catch (error) {
    // Que falle la sugerencia no puede impedir editar el movimiento.
    logger.error("suggest.failed", { error: describeError(error) });
    return NextResponse.json({ error: "No se pudo sugerir." }, { status: 500 });
  }
}

/**
 * El movimiento, con las columnas justas.
 *
 * `card_last4` y `operation_number` NO se piden: lo que no se lee no se puede
 * filtrar por descuido hacia un tercero.
 */
async function findTransaction(id: string): Promise<TransactionRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("transactions")
    .select("id, merchant, comment, operation_type, amount, category")
    .eq("id", id)
    .maybeSingle<TransactionRow>();

  if (error) throw new Error(`No se pudo leer el movimiento: ${error.message}`);
  return data;
}

/**
 * Los movimientos ya categorizados, que son el precedente.
 *
 * En SQL van solo los filtros que no dependen del normalizador; emparejar
 * comercios se hace en memoria. Meterlo en la consulta obligaría a duplicar el
 * normalizador dentro del SQL, y entonces habría dos verdades que pueden
 * discrepar.
 */
async function loadHistory(): Promise<HistoryRow[]> {
  let query = getSupabaseAdmin()
    .from("transactions")
    .select("merchant, category")
    .eq("activo", true)
    .not("category", "is", null)
    .order("transaction_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (!shouldShowTestData()) query = query.eq("is_test", false);

  const { data, error } = await query.returns<HistoryRow[]>();
  if (error) throw new Error(`No se pudo leer el historial: ${error.message}`);

  return data ?? [];
}

/** Ejemplos variados: uno por categoría, para no repetirle diez veces lo mismo. */
function buildExamples(history: HistoryRow[]): Array<{ merchant: string; category: string }> {
  const seen = new Set<string>();
  const examples: Array<{ merchant: string; category: string }> = [];

  for (const row of history) {
    if (!row.category || !row.merchant || seen.has(row.category)) continue;

    seen.add(row.category);
    examples.push({ merchant: redactMerchant(row.merchant), category: row.category });

    if (examples.length >= MAX_EXAMPLES) break;
  }

  return examples;
}

/**
 * El motivo lo redacta el SERVIDOR, con plantillas fijas.
 *
 * Si lo escribiera el modelo, sería texto libre de origen externo pintado en la
 * interfaz del usuario.
 */
function reasonForHistory(match: ReturnType<typeof pickFromHistory>): string | null {
  if (!match) return null;

  const veces = `${match.matches} ${match.matches === 1 ? "movimiento" : "movimientos"}`;

  return match.level === "exacto"
    ? `Ya categorizaste así este mismo comercio (${veces})`
    : `Comercios parecidos van a esta categoría (${veces})`;
}

/** La forma de la respuesta, en un solo sitio para que no diverja. */
function buildResponse(
  category: string | null,
  source: "history" | "gemini" | "none",
  matches: number,
  reason: string | null,
) {
  return {
    // El catálogo son cadenas, no filas: la categoría ES su identificador.
    categoryId: category,
    category,
    summary: getSummaryForCategory(category),
    // Lo deriva el servidor desde el catálogo. Gemini nunca decide el grupo.
    group: getGroupForCategory(category),
    reason,
    source,
    matches,
  };
}
