import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatMessageItem } from "@/lib/chat/types";

/**
 * Qué se ve en cada estado del chat.
 *
 * Se renderiza a HTML con `renderToStaticMarkup`, igual que hace ya
 * `TransactionsTable.test.tsx`: el entorno de Vitest es `node` y no hay jsdom.
 *
 * LO QUE ESTO NO PRUEBA, para que nadie se confíe: no hay eventos, no hay
 * `document` y los `useEffect` NO se ejecutan. Quedan sin cubrir pulsar el botón,
 * escribir, Escape, el foco y el autodesplazamiento. Se compensa teniendo TODA la
 * lógica fuera del DOM —`chatReducer` y `sendChatQuestion`, que sí se prueban a
 * fondo— y dejando aquí solo el marcado. No se añade jsdom: sería la primera
 * dependencia de pruebas del repositorio y solo para esto.
 */

const ruta = vi.hoisted(() => ({ actual: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => ruta.actual,
}));

const { ChatPanel } = await import("./ChatPanel");
const { ChatLauncher } = await import("./ChatLauncher");
const { ChatMessage } = await import("./ChatMessage");

function message(overrides: Partial<ChatMessageItem> = {}): ChatMessageItem {
  return {
    id: "1",
    role: "asistente",
    text: "Gastaste S/ 1,286.20 este mes.",
    historyNote: null,
    result: null,
    ...overrides,
  };
}

function renderPanel(props: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <ChatPanel
      view="abierto"
      messages={[]}
      pending={false}
      onSend={() => {}}
      onMinimize={() => {}}
      onRestore={() => {}}
      onClose={() => {}}
      onClear={() => {}}
      inputRef={createRef<HTMLTextAreaElement>()}
      {...props}
    />,
  );
}

describe("el botón flotante", () => {
  it("aparece con el texto que pidió el usuario", () => {
    ruta.actual = "/movimientos";
    const html = renderToStaticMarkup(<ChatLauncher enabled />);

    expect(html).toContain("Consultar mis datos");
  });

  it("no se pinta sin clave de Gemini", () => {
    // Un chat que siempre falla es peor que no tener chat.
    ruta.actual = "/";
    expect(renderToStaticMarkup(<ChatLauncher enabled={false} />)).toBe("");
  });

  it("no se pinta en la pantalla de acceso", () => {
    // Allí no hay datos que consultar ni sesión con la que hacerlo.
    ruta.actual = "/login";
    expect(renderToStaticMarkup(<ChatLauncher enabled />)).toBe("");
  });

  it("la capa que lo envuelve no intercepta clics de la página", () => {
    // Sin `pointer-events-none` en el envoltorio, una capa fija a pantalla
    // completa se tragaría los clics de toda la aplicación.
    ruta.actual = "/";
    const html = renderToStaticMarkup(<ChatLauncher enabled />);

    expect(html).toContain("pointer-events-none");
    expect(html).toContain("pointer-events-auto");
  });
});

describe("el panel NO es un modal", () => {
  it("no bloquea el resto de la web", () => {
    const html = renderPanel();

    // Sin `aria-modal` y sin velo: el usuario tiene que poder mirar su tabla de
    // movimientos mientras pregunta por ella.
    expect(html).not.toContain("aria-modal");
    expect(html).not.toContain("bg-zinc-950/50");
  });

  it("queda por encima de la cabecera y por debajo del formulario de movimiento", () => {
    // `MovementDialog` y `CategoryCombobox` usan z-50; la cabecera, z-20.
    expect(renderPanel()).toContain("z-40");
  });
});

describe("los tres estados", () => {
  it("abierto muestra la lista y el cuadro de escribir", () => {
    const html = renderPanel({ messages: [message()] });

    expect(html).toContain("Gastaste S/ 1,286.20 este mes.");
    expect(html).toContain("chat-pregunta");
    expect(html).toContain("Enviar");
  });

  it("minimizado pliega el cuerpo pero conserva la cabecera", () => {
    const html = renderPanel({ view: "minimizado", messages: [message()] });

    expect(html).toContain("Consultar mis datos");
    expect(html).not.toContain("chat-pregunta");
    expect(html).toContain("Restaurar el chat");
  });

  it("«Limpiar» solo aparece si hay algo que limpiar", () => {
    expect(renderPanel({ messages: [] })).not.toContain("Limpiar");
    expect(renderPanel({ messages: [message()] })).toContain("Limpiar");
  });

  it("cerrar y minimizar tienen etiqueta accesible", () => {
    const html = renderPanel();

    expect(html).toContain("Cerrar el chat");
    expect(html).toContain("Minimizar el chat");
  });
});

describe("el indicador de espera", () => {
  it("dice exactamente «Consultando tus datos…»", () => {
    expect(renderPanel({ pending: true })).toContain("Consultando tus datos…");
  });

  it("va dentro de la ÚNICA región viva", () => {
    // Dos `aria-live` anidados hacen que los lectores dupliquen o se coman los
    // anuncios.
    const html = renderPanel({ pending: true, messages: [message()] });

    expect(html.match(/aria-live/g)).toHaveLength(1);
  });

  it("el botón de enviar se desactiva mientras consulta", () => {
    const html = renderPanel({ pending: true });

    expect(html).toContain("Consultando…");
    expect(html).toContain("disabled");
  });
});

describe("al abrir por primera vez", () => {
  it("propone ejemplos en vez de un saludo vacío", () => {
    // Un chat en blanco no dice qué sabe responder.
    const html = renderPanel();

    expect(html).toContain("¿Cuánto gasté este mes?");
    expect(html).toContain("Compara mis gastos de agosto y septiembre");
  });
});

describe("el texto del modelo se escapa", () => {
  it("una respuesta con HTML se ve como letras, no como marcado", () => {
    // React lo escapa solo; la prueba está para que nadie sustituya el `<p>` por
    // un `dangerouslySetInnerHTML` sin darse cuenta.
    const html = renderToStaticMarkup(
      <ChatMessage message={message({ text: "<img src=x onerror=alert(1)>" })} />,
    );

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("un fallo se anuncia y se distingue por borde, no solo por color", () => {
    const html = renderToStaticMarkup(
      <ChatMessage message={message({ text: "No pude consultar tus datos.", failed: true })} />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("border-red-200");
  });
});

describe("la tabla de resultados", () => {
  const conTabla = message({
    result: {
      intent: "category_breakdown",
      columns: ["Categoría", "Movimientos", "Monto"],
      rows: [
        { label: "Delivery", count: 12, amount: 486.5 },
        { label: "Otras 7", count: 20, amount: 799.7, rest: true },
      ],
      total: 1286.2,
      periodLabel: "septiembre de 2026",
      omitted: 7,
    },
  });

  it("los importes los formatea el cliente, no el modelo", () => {
    const html = renderToStaticMarkup(<ChatMessage message={conTabla} />);

    // Espacio duro incluido: es el mismo `formatCurrency` de la tabla de
    // Movimientos, así que las dos pantallas escriben la cifra igual.
    expect(html).toMatch(/S\/(&#x27;|\s|&nbsp;)?486\.50/);
    expect(html).toContain("tabular-nums");
  });

  it("dice cuántas filas quedaron fuera", () => {
    // Callarlo haría que una lista parcial pareciera completa.
    const html = renderToStaticMarkup(<ChatMessage message={conTabla} />);

    expect(html).toContain("y 7 más");
    expect(html).toContain("Período: septiembre de 2026");
  });

  it("la fila de resto se distingue", () => {
    const html = renderToStaticMarkup(<ChatMessage message={conTabla} />);

    expect(html).toContain("italic");
  });

  it("la tabla se desplaza dentro de su caja, no la página", () => {
    const html = renderToStaticMarkup(<ChatMessage message={conTabla} />);

    expect(html).toContain("overflow-x-auto");
  });

  it("sin tabla no se pinta nada de tabla", () => {
    // Es el caso de la respuesta fuera de alcance.
    const html = renderToStaticMarkup(<ChatMessage message={message()} />);

    expect(html).not.toContain("<table");
  });

  it("pinta tantas celdas como cabeceras, sean dos o tres", () => {
    // Las respuestas de una sola cifra traen dos columnas. Pintar siempre tres
    // dejaba la cabecera «Valor» encima de la columna del medio y las cifras
    // escalonadas según cada fila trajera importe o recuento.
    const dosColumnas = message({
      result: {
        intent: "total_expenses",
        columns: ["Concepto", "Valor"],
        rows: [
          { label: "Gastos del período", amount: 1286.2, detail: null },
          { label: "Movimientos", amount: null, detail: "14 movimientos" },
        ],
        periodLabel: "septiembre de 2026",
        omitted: 0,
      },
    });

    const html = renderToStaticMarkup(<ChatMessage message={dosColumnas} />);

    expect(html.match(/<th /g)).toHaveLength(2);
    // Dos filas de dos celdas cada una.
    expect(html.match(/<td /g)).toHaveLength(4);
    // Y las dos cifras caen en la MISMA columna, la última.
    expect(html).toMatch(/S\/(&#x27;|\s|&nbsp;)?1,286\.20/);
    expect(html).toContain("14 movimientos");
  });

  it("con tres cabeceras siguen siendo tres celdas", () => {
    const html = renderToStaticMarkup(<ChatMessage message={conTabla} />);

    expect(html.match(/<th /g)).toHaveLength(3);
    expect(html.match(/<td /g)).toHaveLength(6);
  });
});
