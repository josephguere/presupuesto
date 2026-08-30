import { PinForm } from "@/components/PinForm";
import { SetupNotice } from "@/components/SetupNotice";
import { getConfiguredPinHash } from "@/lib/auth/pin";
import { getSessionSecret } from "@/lib/auth/session";

/**
 * Pantalla de acceso.
 *
 * Server Component: aquí no llega nada secreto al navegador. Se comprueba que la
 * autenticación esté configurada, pero lo único que cruza al cliente es un
 * booleano — ni el hash del PIN ni el secreto de sesión salen de esta función.
 *
 * Si falta configuración se dice, igual que se hace con Supabase. Callarlo no
 * añadiría seguridad (el hash sigue sin salir de aquí) y dejaría al usuario ante
 * un formulario que nunca funciona sin ninguna pista de por qué.
 */

export const dynamic = "force-dynamic";

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;

  const configured = Boolean(getConfiguredPinHash() && getSessionSecret());

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-xs">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Presupuesto</h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Ingresa tu código de acceso
          </p>
        </div>

        {configured ? (
          <PinForm next={safeNext(searchParams.next)} />
        ) : (
          <SetupNotice message="Falta configurar el acceso: define AUTH_PIN_HASH y AUTH_SESSION_SECRET. Genera el hash con `npm run auth:hash`." />
        )}
      </div>
    </div>
  );
}

/**
 * A dónde ir tras entrar.
 *
 * Solo se aceptan rutas internas que empiecen por una única barra. Sin este
 * filtro, `?next=https://otro-sitio` convertiría la pantalla de acceso en un
 * redirector abierto: un enlace con nuestro dominio que acaba en el de otro,
 * justo el patrón que se usa para hacer creer que una página falsa es la nuestra.
 */
function safeNext(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;

  if (typeof candidate !== "string") return "/";
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/";

  return candidate;
}
