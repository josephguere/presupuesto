/**
 * Tipos de operación.
 *
 * Los dos primeros son EXACTAMENTE los que produce el parser al leer la etiqueta
 * «Operación realizada» de los correos del BCP; no se han inventado. El resto
 * cubre lo que se registra a mano y el banco no notifica por correo.
 *
 * El campo sigue siendo `text` libre en la base de datos, porque el parser lee
 * lo que diga el correo y no queremos que un texto nuevo del banco rompa la
 * ingesta. Esta lista es solo el catálogo del formulario manual.
 */
export const OPERATION_TYPES = [
  "Consumo Tarjeta de Crédito",
  "Consumo Tarjeta de Débito",
  "Transferencia",
  "Depósito",
  "Retiro",
  "Pago de servicio",
  "Otro",
] as const;

export type OperationType = (typeof OPERATION_TYPES)[number];

/** El que trae marcado el formulario de un movimiento nuevo. */
export const DEFAULT_OPERATION_TYPE: OperationType = "Consumo Tarjeta de Débito";

/**
 * ¿Es un tipo aceptable?
 *
 * Deliberadamente permisivo: acepta cualquier texto no vacío y razonablemente
 * corto, no solo los del catálogo. Si mañana el BCP escribe «Consumo Tarjeta de
 * Crédito Internacional», eso debe guardarse tal cual en lugar de perderse.
 */
export function isValidOperationType(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 120;
}
