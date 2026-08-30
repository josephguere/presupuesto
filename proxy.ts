import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, getSessionSecret, verifySessionToken } from "@/lib/auth/session";

/**
 * Puerta de entrada de la aplicación (antes `middleware.ts`).
 *
 * Decide, antes de que se ejecute ninguna página, si la petición tiene sesión.
 * Todo está cerrado por defecto: para abrir una ruta hay que ponerla
 * explícitamente en `PUBLIC_PREFIXES`. Al revés —listar lo privado— cualquier
 * página nueva nacería desprotegida, que es justo el error que no se ve venir.
 *
 * DOS AUTENTICACIONES SEPARADAS. `/api/ingest/bcp` no pasa por aquí: tiene la
 * suya, la cabecera `x-ingest-key` que valida `lib/ingest/security.ts`. Google
 * Apps Script no tiene navegador ni cookies, así que exigirle la sesión del
 * usuario rompería la ingesta. Son dos mecanismos para dos clientes distintos y
 * no deben mezclarse.
 *
 * Esto corre en el runtime Edge, donde no existe `node:crypto`. Por eso
 * `lib/auth/session.ts` está escrito con Web Crypto: la misma verificación vale
 * aquí y en los Route Handlers.
 *
 * NO ES LA AUTORIZACIÓN, es la primera cerradura. La documentación de Next lo
 * dice explícitamente: el proxy sirve para comprobaciones optimistas, no como
 * solución completa de sesión. Quien decide de verdad son las páginas y las
 * Server Actions, que vuelven a verificar la cookie en el mismo proceso que lee
 * o escribe los datos.
 *
 * (Se llamaba `middleware.ts`; en Next 16 el convenio pasó a `proxy.ts` con la
 * misma semántica.)
 */

/** Rutas accesibles sin sesión. */
const PUBLIC_PREFIXES = [
  // La pantalla de acceso y su endpoint.
  "/login",
  "/api/auth/",
  // La ingesta se autentica con su propia clave compartida.
  "/api/ingest/",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  );
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  const secret = getSessionSecret();
  const authenticated = secret
    ? await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, secret)
    : false;

  // Con sesión, el login sobra: se devuelve al usuario a su resumen.
  if (pathname === "/login") {
    if (!authenticated) return NextResponse.next();
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (isPublic(pathname)) return NextResponse.next();

  if (authenticated) return NextResponse.next();

  // Sin sesión: al login, recordando a dónde iba para volver tras entrar.
  const login = new URL("/login", request.url);
  const target = `${pathname}${search}`;
  if (target !== "/") login.searchParams.set("next", target);

  return NextResponse.redirect(login);
}

/**
 * Todo pasa por aquí salvo los recursos estáticos.
 *
 * Se excluyen solo cosas que no son de la aplicación (los assets de Next y el
 * favicon). Cualquier ruta nueva —página o API— queda protegida sin que haya
 * que acordarse de añadirla.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)"],
};
