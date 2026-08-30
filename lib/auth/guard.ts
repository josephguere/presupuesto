import { cookies } from "next/headers";
import { SESSION_COOKIE, getSessionSecret, verifySessionToken } from "./session";

/**
 * Comprobación de sesión para Server Components y Server Actions.
 *
 * El proxy ya redirige al login a quien no tenga cookie, pero eso es una
 * comodidad de navegación, no la defensa. Una Server Action es un endpoint
 * público que escribe con la `service_role` key: quien conozca su identificador
 * puede invocarla directamente. Por eso cada acción que escribe vuelve a
 * comprobar aquí, en el mismo proceso que hace el UPDATE.
 *
 * Dicho de otro modo: el proxy decide qué se ve; esto decide qué se puede
 * hacer. Y lo segundo no puede depender de lo primero.
 */

/** ¿Trae la petición actual una cookie de sesión válida y vigente? */
export async function hasValidSession(): Promise<boolean> {
  const secret = getSessionSecret();
  // Sin secreto no se puede verificar nada: se deniega en vez de dejar pasar.
  if (!secret) return false;

  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value, secret);
}

/** Mensaje único de sesión ausente. No distingue caducada de inexistente. */
export const SESSION_REQUIRED_MESSAGE = "Tu sesión expiró. Vuelve a ingresar tu código.";
