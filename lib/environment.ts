/**
 * Separación entre datos de prueba y datos reales.
 *
 * EL PROBLEMA: local y producción comparten la misma base de datos de Supabase.
 * Los movimientos que creas con `npm run post:sample` aparecerían también en el
 * dashboard público, mezclados con tus consumos de verdad y falseando los
 * totales del mes.
 *
 * LA SOLUCIÓN: cada fila lleva un `is_test`, y quien lo decide es el ENTORNO
 * DONDE SE INGIRIÓ, no el payload:
 *
 *   `npm run post:sample` → localhost → desarrollo → is_test = true
 *   Google Apps Script    → Vercel    → producción → is_test = false
 *
 * Que lo decida el entorno y no un campo del JSON es deliberado: nadie puede
 * marcar datos como reales —o como falsos— desde fuera.
 *
 * Luego el dashboard, en producción, solo muestra `is_test = false`. En local
 * los ves todos. Misma base de datos, dos vistas.
 */

/**
 * `true` con `next dev`; `false` en Vercel y en cualquier build de producción.
 *
 * Next.js fija `NODE_ENV` según el comando, así que no hay nada que configurar.
 * Ojo con el caso raro: `npm run build && npm start` en tu máquina cuenta como
 * producción, y con razón — estás ejecutando un build de producción.
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * ¿Debe esta ingesta marcarse como prueba?
 *
 * Se lee en el momento de guardar, no al importar el módulo, para que los tests
 * puedan cambiar el entorno.
 */
export function shouldMarkAsTest(): boolean {
  return isDevelopment();
}

/** ¿Debe el dashboard mostrar también los movimientos de prueba? */
export function shouldShowTestData(): boolean {
  return isDevelopment();
}
