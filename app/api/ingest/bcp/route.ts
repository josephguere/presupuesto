import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBcpEmail } from "@/lib/parsers/bcp";
import type { ParsedTransaction } from "@/lib/parsers/types";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import {
  authorizeIngestRequest,
  extractEmailAddress,
  isAllowedSender,
  matchesSubjectFilter,
} from "@/lib/ingest/security";
import { describeError, logger } from "@/lib/logger";
import type { EmailIngestionRow, ProcessingStatus } from "@/types/transaction";

/**
 * POST /api/ingest/bcp — punto de entrada de los correos del BCP.
 *
 * Google Apps Script detecta el correo, lo lee y lo manda aquí. Toda la lógica
 * de negocio (validar, interpretar, deduplicar, guardar) vive en este lado.
 *
 * CONTRATO HTTP — importa para que Apps Script no entre en bucle:
 *
 *   2xx  El correo quedó guardado. NO reintentes.
 *        Incluye PARSE_ERROR: el formato no se entendió, reintentar no ayuda.
 *        Se arregla corrigiendo el parser y reprocesando desde base de datos.
 *
 *   4xx  Petición mal formada o no autorizada. Reintentar tampoco ayuda, pero
 *        Apps Script no marca el correo: hay que arreglar la configuración.
 *
 *   5xx  Fallo transitorio (Supabase caído, red). Apps Script reintentará en el
 *        siguiente disparo del trigger.
 */

// El endpoint usa node:crypto y escribe en base de datos: nada que cachear.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tope defensivo: un correo del banco no llega ni de lejos a este tamaño. */
const MAX_RAW_BODY_LENGTH = 200_000;

/**
 * Forma exacta de lo que envía Apps Script.
 *
 * `strict()` a propósito: si un día el script empieza a mandar un campo que la
 * API no conoce, preferimos enterarnos con un 400 antes que ignorarlo en
 * silencio durante semanas.
 */
const IngestPayloadSchema = z
  .object({
    gmailMessageId: z.string().trim().min(1).max(256),
    gmailThreadId: z.string().trim().max(256).nullish(),
    from: z.string().trim().min(3).max(512),
    to: z.string().trim().max(512).nullish(),
    subject: z.string().max(2048).nullish(),
    receivedAt: z
      .string()
      .trim()
      .refine((value) => !Number.isNaN(Date.parse(value)), {
        message: "receivedAt debe ser una fecha ISO-8601 válida",
      })
      .nullish(),
    rawBody: z.string().min(1).max(MAX_RAW_BODY_LENGTH),
  })
  .strict();

type IngestPayload = z.infer<typeof IngestPayloadSchema>;

/** Código de PostgreSQL para violación de restricción única. */
const PG_UNIQUE_VIOLATION = "23505";

export async function POST(request: Request): Promise<NextResponse> {
  // ---- 1. Autorización -----------------------------------------------------
  const auth = authorizeIngestRequest(request);
  if (!auth.ok) {
    // Se registra el MOTIVO, nunca la clave recibida ni la esperada.
    logger.warn("ingest.unauthorized", { reason: auth.reason });

    if (auth.reason === "NOT_CONFIGURED") {
      return jsonError(500, "SERVER_MISCONFIGURED", "GMAIL_INGEST_KEY no está configurada.");
    }
    return jsonError(401, "UNAUTHORIZED", "Cabecera x-ingest-key ausente o inválida.");
  }

  // ---- 2. Validación del payload ------------------------------------------
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "INVALID_JSON", "El cuerpo de la petición no es JSON válido.");
  }

  const parsedPayload = IngestPayloadSchema.safeParse(body);
  if (!parsedPayload.success) {
    const issues = parsedPayload.error.issues
      .map((issue) => `${issue.path.join(".") || "(raíz)"}: ${issue.message}`)
      .join("; ");
    logger.warn("ingest.invalid_payload", { issues });
    return jsonError(400, "INVALID_PAYLOAD", issues);
  }

  const payload = parsedPayload.data;

  // ---- 3. El correo tiene que venir de quien esperamos ---------------------
  if (!isAllowedSender(payload.from)) {
    logger.warn("ingest.sender_rejected", {
      gmailMessageId: payload.gmailMessageId,
      sender: extractEmailAddress(payload.from),
    });
    return jsonError(403, "SENDER_NOT_ALLOWED", "El remitente no está en la lista permitida.");
  }

  if (!matchesSubjectFilter(payload.subject)) {
    logger.warn("ingest.subject_rejected", { gmailMessageId: payload.gmailMessageId });
    return jsonError(403, "SUBJECT_NOT_ALLOWED", "El asunto no coincide con BCP_SUBJECT_FILTER.");
  }

  if (!isSupabaseConfigured()) {
    logger.error("ingest.supabase_not_configured");
    return jsonError(500, "SERVER_MISCONFIGURED", "Faltan las variables de Supabase.");
  }

  // ---- 4. A partir de aquí, base de datos ---------------------------------
  try {
    return await ingest(payload);
  } catch (error) {
    const message = describeError(error);
    logger.error("ingest.unexpected_error", {
      gmailMessageId: payload.gmailMessageId,
      error: message,
    });
    // 500 → fallo posiblemente transitorio: Apps Script reintentará.
    return jsonError(500, "INTERNAL_ERROR", message);
  }
}

/**
 * Comprobación de salud para verificar la configuración desde Apps Script o
 * desde tu terminal. Exige la clave, y solo responde con booleanos: nunca
 * revela el valor de ninguna variable.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = authorizeIngestRequest(request);
  if (!auth.ok) {
    return jsonError(
      auth.reason === "NOT_CONFIGURED" ? 500 : 401,
      "UNAUTHORIZED",
      "Cabecera x-ingest-key ausente o inválida.",
    );
  }

  return NextResponse.json({
    ok: true,
    endpoint: "/api/ingest/bcp",
    supabaseConfigured: isSupabaseConfigured(),
  });
}

/* -------------------------------------------------------------------------- */
/* Orquestación                                                               */
/* -------------------------------------------------------------------------- */

async function ingest(payload: IngestPayload): Promise<NextResponse> {
  // ---- Idempotencia: ¿ya conocemos este correo? ---------------------------
  const existing = await findEmailByGmailId(payload.gmailMessageId);

  if (existing?.processing_status === "PROCESSED") {
    const transactionId = await findTransactionIdForEmail(existing.id);
    logger.info("ingest.already_processed", {
      gmailMessageId: payload.gmailMessageId,
      emailId: existing.id,
    });

    return NextResponse.json({
      ok: true,
      status: "ALREADY_PROCESSED" satisfies ResponseStatus,
      emailId: existing.id,
      transactionId,
    });
  }

  // No está procesado: o es nuevo, o quedó a medias (RECEIVED / PARSE_ERROR /
  // ERROR). En ambos casos guardamos y seguimos; reprocesar un correo que antes
  // falló no debería exigir borrarlo a mano de la base de datos.
  const email = await storeEmail(payload);

  logger.info("ingest.email_stored", {
    gmailMessageId: payload.gmailMessageId,
    emailId: email.id,
    reused: Boolean(existing),
    rawBodyLength: payload.rawBody.length,
  });

  // ---- Parseo -------------------------------------------------------------
  const parseResult = parseBcpEmail(payload.rawBody);

  if (!parseResult.ok) {
    // El correo crudo se conserva: mañana se arregla el parser y se reprocesa.
    await updateEmailStatus(email.id, "PARSE_ERROR", parseResult.error.message);

    logger.warn("ingest.parse_error", {
      gmailMessageId: payload.gmailMessageId,
      emailId: email.id,
      code: parseResult.error.code,
    });

    // 200 a propósito: el correo está guardado y reintentar no cambiaría nada.
    return NextResponse.json(
      {
        ok: false,
        status: "PARSE_ERROR" satisfies ResponseStatus,
        emailId: email.id,
        error: {
          code: parseResult.error.code,
          message: parseResult.error.message,
          missingFields: parseResult.error.missingFields ?? [],
        },
      },
      { status: 200 },
    );
  }

  // ---- Transacción --------------------------------------------------------
  const transaction = parseResult.data;
  const transactionId = await upsertTransaction(email.id, transaction);

  await updateEmailStatus(email.id, "PROCESSED", null);

  logger.info("ingest.processed", {
    gmailMessageId: payload.gmailMessageId,
    emailId: email.id,
    transactionId,
    merchant: transaction.merchant,
    amount: transaction.amount,
    currency: transaction.currency,
  });

  return NextResponse.json({
    ok: true,
    status: "PROCESSED" satisfies ResponseStatus,
    emailId: email.id,
    transactionId,
  });
}

/* -------------------------------------------------------------------------- */
/* Acceso a datos                                                             */
/* -------------------------------------------------------------------------- */

async function findEmailByGmailId(gmailMessageId: string): Promise<EmailIngestionRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("email_ingestions")
    .select("*")
    .eq("gmail_message_id", gmailMessageId)
    .maybeSingle<EmailIngestionRow>();

  if (error) throw new Error(`No se pudo consultar email_ingestions: ${error.message}`);
  return data;
}

/**
 * Guarda el correo crudo: lo inserta si es nuevo, lo refresca si ya estaba.
 *
 * Es un `upsert` sobre `gmail_message_id` por dos motivos:
 *
 *  1. Resuelve la carrera. Si dos disparos del trigger coinciden, no hay
 *     violación de unicidad que atrapar: gana la última escritura y ambas
 *     peticiones acaban viendo la misma fila.
 *
 *  2. Mantiene coherente el correo guardado. Al reprocesar, la transacción se
 *     deriva del `rawBody` que acaba de llegar, así que ese es el que tiene que
 *     quedar almacenado como evidencia — no el de un intento anterior.
 */
async function storeEmail(payload: IngestPayload): Promise<EmailIngestionRow> {
  const { data, error } = await getSupabaseAdmin()
    .from("email_ingestions")
    .upsert(
      {
        gmail_message_id: payload.gmailMessageId,
        gmail_thread_id: payload.gmailThreadId ?? null,
        sender_email: extractEmailAddress(payload.from),
        recipient_email: payload.to ? extractEmailAddress(payload.to) : null,
        subject: payload.subject ?? null,
        received_at: payload.receivedAt ?? null,
        raw_body: payload.rawBody,
        source: "GMAIL_BCP",
        // Vuelve a RECEIVED: estamos a punto de (re)procesarlo.
        processing_status: "RECEIVED" satisfies ProcessingStatus,
        processing_error: null,
      },
      { onConflict: "gmail_message_id" },
    )
    .select("*")
    .single<EmailIngestionRow>();

  if (error) throw new Error(`No se pudo guardar en email_ingestions: ${error.message}`);

  return data;
}

async function updateEmailStatus(
  emailId: string,
  status: ProcessingStatus,
  processingError: string | null,
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("email_ingestions")
    .update({ processing_status: status, processing_error: processingError })
    .eq("id", emailId);

  if (error) throw new Error(`No se pudo actualizar el estado del correo: ${error.message}`);
}

async function findTransactionIdForEmail(emailId: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("transactions")
    .select("id")
    .eq("email_ingestion_id", emailId)
    .maybeSingle<{ id: string }>();

  if (error) throw new Error(`No se pudo consultar transactions: ${error.message}`);
  return data?.id ?? null;
}

/**
 * Crea la transacción del correo, o devuelve la que ya existía.
 *
 * `email_ingestion_id` es UNIQUE, así que la base de datos es la que garantiza
 * «un correo, una transacción» — no la lógica de la aplicación.
 */
async function upsertTransaction(
  emailId: string,
  transaction: ParsedTransaction,
): Promise<string> {
  const { data, error } = await getSupabaseAdmin()
    .from("transactions")
    .insert({
      email_ingestion_id: emailId,
      bank: transaction.bank,
      operation_type: transaction.operationType,
      transaction_at: transaction.transactionAt,
      amount: transaction.amount,
      currency: transaction.currency,
      merchant: transaction.merchant,
      card_last4: transaction.cardLast4,
      operation_number: transaction.operationNumber,
      category: null,
      source: transaction.source,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      const existingId = await findTransactionIdForEmail(emailId);
      if (existingId) {
        logger.info("ingest.transaction_already_exists", { emailId, transactionId: existingId });
        return existingId;
      }
    }
    throw new Error(`No se pudo insertar la transacción: ${error.message}`);
  }

  return data.id;
}

/* -------------------------------------------------------------------------- */
/* Utilidades de respuesta                                                    */
/* -------------------------------------------------------------------------- */

type ResponseStatus = "PROCESSED" | "ALREADY_PROCESSED" | "PARSE_ERROR";

function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ ok: false, status: code, error: { code, message } }, { status });
}
