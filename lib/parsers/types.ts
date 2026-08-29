import type { Bank, CurrencyCode, TransactionSource } from "@/types/transaction";

/** Transacción extraída de un correo, antes de tocar la base de datos. */
export interface ParsedTransaction {
  bank: Bank;
  operationType: string;
  /** ISO-8601 con offset explícito, p. ej. `2026-08-26T18:28:00-05:00`. */
  transactionAt: string;
  amount: number;
  currency: CurrencyCode;
  merchant: string;
  cardLast4: string | null;
  operationNumber: string;
  source: TransactionSource;
}

/** Motivo por el que un correo no se pudo interpretar. */
export type ParseErrorCode =
  /** El correo no es del tipo que este parser maneja. */
  | "NOT_A_MATCH"
  /** Es del tipo correcto, pero faltan campos obligatorios. */
  | "MISSING_FIELDS"
  /** Un campo estaba presente pero con un formato ilegible. */
  | "INVALID_FORMAT";

export interface ParseError {
  code: ParseErrorCode;
  /** Mensaje legible, apto para guardar en `processing_error`. */
  message: string;
  /** Campos obligatorios que no se pudieron extraer. */
  missingFields?: string[];
}

/**
 * Resultado de un parser: unión discriminada, nunca una excepción.
 *
 * Un correo raro es un caso de negocio esperado, no un fallo del programa. Por
 * eso los parsers devuelven errores en lugar de lanzarlos: la API decide qué
 * hacer y el correo crudo se conserva igualmente.
 */
export type ParseResult<T = ParsedTransaction> =
  | { ok: true; data: T }
  | { ok: false; error: ParseError };
