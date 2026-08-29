/**
 * Tipos de dominio del presupuesto.
 *
 * Convención: los tipos `*Row` reflejan **exactamente** las columnas de
 * PostgreSQL (snake_case). El resto son tipos de dominio (camelCase) que usan
 * el parser, la API y la UI. La traducción entre ambos mundos ocurre solo en
 * la capa de acceso a datos.
 */

/** Estados posibles de `email_ingestions.processing_status`. */
export const PROCESSING_STATUSES = [
  "RECEIVED",
  "PROCESSED",
  "PARSE_ERROR",
  "ERROR",
] as const;

export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

/**
 * Origen del dato. Al añadir bancos nuevos se agregan variantes aquí
 * (`GMAIL_INTERBANK`, `GMAIL_BBVA`, ...) sin tocar el resto del modelo.
 */
export type TransactionSource = "GMAIL_BCP";

/** Bancos soportados. Hoy solo BCP; el modelo ya es multi-banco. */
export type Bank = "BCP";

/** Moneda en formato ISO-4217. */
export type CurrencyCode = "PEN" | "USD";

/* -------------------------------------------------------------------------- */
/* Filas de base de datos                                                      */
/* -------------------------------------------------------------------------- */

/** Fila de `email_ingestions`: el correo crudo, tal como llegó. */
export interface EmailIngestionRow {
  id: string;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  sender_email: string;
  recipient_email: string | null;
  subject: string | null;
  received_at: string | null;
  raw_body: string;
  source: string | null;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Fila de `transactions`: la información ya estructurada. */
export interface TransactionRow {
  id: string;
  email_ingestion_id: string;
  bank: string | null;
  operation_type: string | null;
  transaction_at: string | null;
  /**
   * `NUMERIC(12,2)`. supabase-js lo entrega como `string` para no perder
   * precisión; conviértelo con `Number()` justo antes de calcular o mostrar.
   */
  amount: string | number | null;
  currency: string | null;
  merchant: string | null;
  card_last4: string | null;
  operation_number: string | null;
  category: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

/* -------------------------------------------------------------------------- */
/* Dominio                                                                     */
/* -------------------------------------------------------------------------- */

/** Movimiento listo para renderizar: montos ya numéricos, sin nulls sorpresa. */
export interface Transaction {
  id: string;
  bank: string;
  operationType: string;
  /** ISO-8601 con offset, p. ej. `2026-08-26T18:28:00-05:00`. */
  transactionAt: string | null;
  amount: number;
  currency: string;
  merchant: string;
  cardLast4: string | null;
  operationNumber: string | null;
  category: string | null;
}

/** Métricas del encabezado del dashboard. */
export interface MonthlySummary {
  /** Mes en formato `YYYY-MM`. */
  month: string;
  totalSpent: number;
  transactionCount: number;
  averageAmount: number;
  largestAmount: number;
  currency: CurrencyCode;
}
