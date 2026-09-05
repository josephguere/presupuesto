"use client";

import { Component, type ReactNode } from "react";

/**
 * El chat, aislado del resto de la aplicación.
 *
 * En el App Router un error de render que nadie captura sube hasta el `error.tsx`
 * más cercano y SUSTITUYE LA PÁGINA ENTERA. Sin esto, un fallo del chat —una
 * respuesta con una forma que no esperábamos, un error tonto en un componente—
 * dejaría al usuario mirando una pantalla de error en lugar de sus movimientos.
 *
 * Al fallar renderiza `null`: el chat desaparece y la aplicación sigue.
 *
 * Es la garantía ESTRUCTURAL de «nunca bloquear el resto de la web». Los topes de
 * tiempo son la temporal —evitan que se quede colgado—, pero solo esto evita que
 * se lo lleve todo por delante.
 *
 * Componente de clase porque los límites de error no tienen equivalente en
 * hooks; es el único de todo el proyecto.
 */
export class ChatBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    // A la consola y nada más: no hay a quién avisar y una alerta al usuario por
    // algo que no puede arreglar solo estorbaría.
    console.error("[presupuesto] chat.render_failed", error.message);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
