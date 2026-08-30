"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/**
 * Cabecera de la aplicación: navegación y cierre de sesión.
 *
 * En móvil, un botón hamburguesa; a partir de `sm`, la barra horizontal de
 * siempre. Cinco enlaces en la parte superior de un teléfono se comen el alto
 * útil y obligan a apuntar a objetivos diminutos.
 *
 * Es un Client Component solo para saber en qué ruta está: en la pantalla de
 * acceso no debe verse ni la navegación ni el botón de salir, y hay que marcar
 * la página activa. La alternativa —mover las páginas a un grupo de rutas con su
 * propio layout— reorganizaría medio proyecto para conseguir lo mismo.
 *
 * Ojo con lo que esto NO es: ocultar los enlaces no protege nada. Quien escriba
 * la URL a mano se topa con el proxy, y quien llame a una Server Action se topa
 * con su comprobación de sesión. Esto es interfaz, no seguridad.
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
  /**
   * Menú abierto, anotando EN QUÉ ruta se abrió.
   *
   * Así «cerrado al cambiar de página» sale solo: en cuanto `pathname` cambia,
   * el valor guardado deja de coincidir y el menú se cierra —también al volver
   * atrás con el navegador—. Un `useEffect` que llamara a `setOpen` haría lo
   * mismo con un render de más, y además es justo lo que prohíbe la regla
   * `react-hooks/set-state-in-effect`.
   */
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;

  function setOpen(next: boolean) {
    setOpenPath(next ? pathname : null);
  }

  // Escape cierra, como en cualquier menú.
  useEffect(() => {
    if (!open) return;

    // `setOpenPath` directamente: es la función estable de `useState`, así que
    // el efecto no depende de nada que cambie en cada render.
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenPath(null);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  if (pathname === "/login") return null;

  function handleLogout() {
    setOpen(false);
    startTransition(async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    });
  }

  /** La página activa. `/` solo casa consigo misma, no con todo lo demás. */
  function isActive(href: string): boolean {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-zinc-50/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-3 py-3 sm:px-6">
        <Link href="/" className="font-semibold tracking-tight">
          Presupuesto
        </Link>

        {/* Escritorio */}
        <div className="hidden items-center gap-1 text-sm sm:flex">
          <nav className="flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 transition-colors ${
                  isActive(link.href)
                    ? "bg-zinc-200/70 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-50"
                }`}
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

        {/* Móvil */}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={open}
          aria-controls="menu-movil"
          className="-mr-1 rounded-lg p-2 text-zinc-600 transition-colors hover:bg-zinc-200/60 sm:hidden dark:text-zinc-400 dark:hover:bg-zinc-800/60"
        >
          {/* Tres barras que se cruzan al abrirse. Dibujarlo con divs evita
              cargar un paquete de iconos entero por dos formas. */}
          <span className="sr-only">Menú</span>
          <span aria-hidden="true" className="flex h-4 w-5 flex-col justify-between">
            <span
              className={`h-0.5 w-full rounded bg-current transition-transform ${
                open ? "translate-y-[7px] rotate-45" : ""
              }`}
            />
            <span
              className={`h-0.5 w-full rounded bg-current transition-opacity ${
                open ? "opacity-0" : ""
              }`}
            />
            <span
              className={`h-0.5 w-full rounded bg-current transition-transform ${
                open ? "-translate-y-[7px] -rotate-45" : ""
              }`}
            />
          </span>
        </button>
      </div>

      {open && (
        <nav
          id="menu-movil"
          className="border-t border-zinc-200 px-3 py-2 sm:hidden dark:border-zinc-800"
        >
          <ul className="flex flex-col gap-0.5">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={isActive(link.href) ? "page" : undefined}
                  className={`block rounded-lg px-3 py-2.5 text-sm transition-colors ${
                    isActive(link.href)
                      ? "bg-zinc-200/70 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                      : "text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            ))}

            <li className="mt-1 border-t border-zinc-200 pt-1 dark:border-zinc-800">
              <button
                type="button"
                onClick={handleLogout}
                disabled={isPending}
                className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-zinc-500 transition-colors hover:bg-zinc-200/60 disabled:opacity-50 dark:text-zinc-500 dark:hover:bg-zinc-800/60"
              >
                {isPending ? "Saliendo..." : "Cerrar sesión"}
              </button>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
