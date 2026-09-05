/**
 * ¿Está el chat disponible?
 *
 * Vive en su propio módulo, y no dentro de `lib/ai/gemini.ts`, porque quien
 * pregunta es `app/layout.tsx` —que se ejecuta en CADA página— y no tiene por
 * qué arrastrar el módulo que importa el SDK, los prompts y el catálogo entero
 * solo para leer una variable de entorno.
 *
 * La clave se lee en el momento de preguntar, no al importar: así los tests
 * pueden cambiar el entorno con `vi.stubEnv` sin reiniciar el módulo.
 */

/** Modelo por defecto, compartido con la sugerencia de categoría. */
export const DEFAULT_CHAT_MODEL = "gemini-3.5-flash-lite";

/** El modelo configurado, o el de por defecto. */
export function chatModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_CHAT_MODEL;
}

/**
 * Sin clave no hay chat.
 *
 * Aquí NO se degrada como en la sugerencia de categoría, que sigue funcionando
 * con el historial: un chat sin modelo no puede entender una pregunta escrita en
 * castellano, así que no hay nada que ofrecer. El botón flotante no se pinta y el
 * endpoint responde 503; enseñar un chat que siempre falla es peor que no
 * enseñarlo.
 */
export function isChatConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}
