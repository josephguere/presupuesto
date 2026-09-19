import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatChartView } from "./ChatChartView";

/**
 * El grafico del chat, dibujado a mano con SVG y divs.
 *
 * Se renderiza a HTML con `renderToStaticMarkup`, igual que el resto de
 * componentes: el entorno de Vitest es `node` y no hay jsdom. Eso alcanza de
 * sobra aqui, porque el grafico NO tiene eventos ni estado — es una funcion de
 * sus datos a marcado.
 *
 * Lo que se fija: que cada punto salga, que la escala sea relativa al mayor, y
 * los dos bordes que romperian el dibujo —un solo punto y todos los valores a
 * cero, que dividiria entre cero—.
 */
describe("render del grafico", () => {
  it("barras: pinta una por punto, con su importe", () => {
    const html = renderToStaticMarkup(
      <ChatChartView
        chart={{
          type: "bar",
          unit: "PEN",
          points: [
            { label: "Delivery", value: 486.5 },
            { label: "Supermercado", value: 312 },
          ],
        }}
      />,
    );

    expect(html).toContain("Delivery");
    expect(html).toContain("Supermercado");
    expect(html).toMatch(/S\/(&#x27;|\s|&nbsp;)?486\.50/);
    // La mayor al 100%, la otra proporcional.
    expect(html).toContain("width:100%");
    expect(html).toContain("width:64");
  });

  it("linea: dibuja la polilinea y las etiquetas", () => {
    const html = renderToStaticMarkup(
      <ChatChartView
        chart={{
          type: "line",
          unit: "PEN",
          points: [
            { label: "Jul", value: 900 },
            { label: "Ago", value: 1100 },
            { label: "Sep", value: 1000 },
          ],
        }}
      />,
    );

    expect(html).toContain("<polyline");
    expect(html).toContain("Jul");
    expect(html).toContain("Sep");
    expect(html).toContain('role="img"');
  });

  it("con un solo punto no pinta nada", () => {
    const html = renderToStaticMarkup(
      <ChatChartView chart={{ type: "bar", unit: "PEN", points: [{ label: "A", value: 1 }] }} />,
    );

    expect(html).toBe("");
  });

  it("todos a cero no divide entre cero", () => {
    const html = renderToStaticMarkup(
      <ChatChartView
        chart={{
          type: "bar",
          unit: "PEN",
          points: [
            { label: "A", value: 0 },
            { label: "B", value: 0 },
          ],
        }}
      />,
    );

    expect(html).toContain("width:0%");
    expect(html).not.toContain("NaN");
  });
});
