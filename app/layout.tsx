import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Presupuesto",
  description: "Movimientos y gastos del mes, directos desde tus correos del banco.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-zinc-50 font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
        {/* Se oculta sola en /login: allí no hay dónde navegar ni de dónde salir. */}
        <AppHeader />

        {/* `px-3` en movil: el contenido gana 8 px a cada lado sin pegarse al
            borde. `max-w-5xl` solo entra en juego a partir de esa anchura. */}
        <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-5 sm:px-6 sm:py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
