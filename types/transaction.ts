import type { Category, Group } from "@/lib/categories";

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
 * Cómo entró el movimiento al sistema.
 *
 * `EMAIL` llegó por Gmail, `MANUAL` lo registró el usuario. No es editable: un
 * movimiento que vino de un correo lo siguió haciendo siempre.
 */
export const ORIGINS = ["EMAIL", "MANUAL"] as const;

export type Origin = (typeof ORIGINS)[number];

/**
 * Origen del dato bancario. Al añadir bancos se agregan variantes aquí
 * (`GMAIL_INTERBANK`, `GMAIL_BBVA`, ...) sin tocar el resto del modelo.
 */
export type TransactionSource = "GMAIL_BCP" | "MANUAL";

/** Bancos soportados. */
export type Bank = "BCP";

/** Moneda en formato ISO-4217. */
export type CurrencyCode = "PEN" | "USD";

/** Moneda en la que vive toda la aplicación. */
export const BASE_CURRENCY = "PEN";

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
  is_test: boolean;
  created_at: string;
  updated_at: string;
}

/** Fila de `transactions`: la información ya estructurada. */
export interface TransactionRow {
  id: string;
  /** `null` en los movimientos manuales: no vienen de ningún correo. */
  email_ingestion_id: string | null;
  bank: string | null;
  operation_type: string | null;
  transaction_at: string | null;
  /**
   * `NUMERIC(12,2)`, **siempre en soles**. supabase-js lo entrega como `string`
   * para no perder precisión; conviértelo con `Number()` al leerlo.
   */
  amount: string | number | null;
  currency: string | null;
  merchant: string | null;
  card_last4: string | null;
  operation_number: string | null;
  category: string | null;
  comment: string | null;
  origin: Origin;
  source: string | null;
  /** Trazabilidad de la conversión: importe tal como venía en el correo. */
  original_amount: string | number | null;
  original_currency: string | null;
  exchange_rate: string | number | null;
  exchange_rate_date: string | null;
  exchange_rate_source: string | null;
  /** Eliminacion logica: `false` = dado de baja, sigue en la tabla. */
  activo: boolean;
  /** Cuando se dio de baja. `null` mientras esta activo. */
  eliminado_at: string | null;
  is_test: boolean;
  created_at: string;
  updated_at: string;
}

/* -------------------------------------------------------------------------- */
/* Dominio                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Movimiento listo para renderizar.
 *
 * `amount` está siempre en soles: la conversión desde dólares ocurre en la
 * ingesta, no aquí. La interfaz nunca ve otra moneda.
 */
export interface Transaction {
  id: string;
  bank: string;
  /** «Tipo» en la interfaz. */
  operationType: string;
  /** ISO-8601 con offset, p. ej. `2026-08-26T18:28:00-05:00`. */
  transactionAt: string | null;
  /** Importe en soles. */
  amount: number;
  /** «Movimiento» en la interfaz; en base de datos sigue siendo `merchant`. */
  merchant: string;
  cardLast4: string | null;
  operationNumber: string | null;
  comment: string | null;
  category: Category | null;
  /** Derivado de la categoría, nunca almacenado. */
  group: Group | null;
  origin: Origin;
  /**
   * Fecha de baja lógica, o `null` si el movimiento está activo.
   *
   * Las listas ya vienen filtradas por estado, así que esto no decide qué se
   * muestra: solo permite a «Eliminados» poner fecha a cada baja.
   */
  deletedAt: string | null;
}

/** Métricas del encabezado del resumen. Todos los importes en soles. */
export interface Summary {
  ingresos: number;
  gastosFijos: number;
  gastosVariables: number;
  /** `gastosFijos + gastosVariables`. */
  gastosTotales: number;
  /** `ingresos - gastosTotales`. */
  balance: number;
  /** Importe de los movimientos que aún no tienen categoría. */
  pendienteCategorizar: number;
  /** Cuántos movimientos están sin categorizar. */
  pendienteCategorizarCount: number;

  /** Métricas de gasto que ya existían antes de los grupos. */
  totalSpent: number;
  transactionCount: number;
  averageAmount: number;
  largestAmount: number;
}

/** Una fila del resumen por categoría. */
export interface CategoryTotal {
  category: Category | null;
  group: Group | null;
  total: number;
  count: number;
}
