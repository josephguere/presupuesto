"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Cabecera de la aplicación: navegación y cierre de sesión.
 *
 * Es un Client Component solo para saber en qué ruta está: en la pantalla de
 * acceso no debe verse ni la navegación ni el botón de salir. La alternativa
 * —mover las páginas a un grupo de rutas con su propio layout— reorganizaría
 * medio proyecto para conseguir lo mismo.
 *
 * Ojo con lo que esto NO es: ocultar los enlaces no protege nada. Quien escriba
 * la URL a mano se topa con el proxy, y quien llame a una Server Action se
 * topa con su comprobación de sesión. Esto es interfaz, no seguridad.
 */

const NAV_LINKS = [
  { href: "/", label: "Resumen" },
  { href: "/movimientos", label: "Movimientos" },
  { href: "/eliminados", label: "Eliminados" },
] as const;

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (pathname === "/login") return null;

  function handleLogout() {
    startTransition(async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    });
  }

  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="font-semibold tracking-tight">
          Presupuesto
        </Link>

        <div className="flex items-center gap-1 text-sm">
          <nav className="flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-1.5 text-zinc-600 transition-colors hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-50"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <button
            type="button"
            onClick={handleLogout}
            disabled={isPending}
            className="ml-1 rounded-lg px-3 py-1.5 text-zinc-400 transition-colors hover:bg-zinc-200/60 hover:text-zinc-700 disabled:opacity-50 dark:text-zinc-500 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-300"
          >
            {isPending ? "Saliendo..." : "Cerrar sesión"}
          </button>
        </div>
      </div>
    </header>
  );
}
