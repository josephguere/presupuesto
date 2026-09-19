"use client";

import { formatCurrency } from "@/lib/format";
import type { ChatChart } from "@/lib/chat/types";

/**
 * El gráfico que acompaña a una respuesta del chat.
 *
 * SVG A MANO, SIN LIBRERÍA. El proyecto no tiene ninguna —el combobox, los
 * iconos de la cabecera y la barra de las metas también están hechos así— y
 * traerse una costaría más peso que todo este archivo para dibujar barras y una
 * línea. Si algún día hacen falta ejes con escalas, zoom o tooltips, entonces sí
 * toca librería; hoy no.
 *
 * DOS FORMAS, y la diferencia no es estética:
 *
 *   · BARRAS HORIZONTALES para comparar cosas distintas (categorías, grupos,
 *     dos períodos). Horizontales y no verticales porque las etiquetas son
 *     nombres largos —«Peajes y estacionamiento»— y en vertical habría que
 *     girarlas, que en un móvil es ilegible. En horizontal la etiqueta se lee
 *     de corrido y la barra crece hacia la derecha.
 *
 *   · LÍNEA para una evolución en el tiempo, donde el orden de los puntos
 *     significa algo y lo que importa es la forma, no el valor exacto.
 *
 * RESPONSIVE SIN JAVASCRIPT: el contenedor de barras es una rejilla normal de
 * CSS, y la línea usa `viewBox` con `preserveAspectRatio="none"`, así que el SVG
 * se estira al ancho que haya. No se mide el contenedor ni se escucha el
 * `resize`: nada que recalcular al girar el teléfono.
 *
 * LOS NÚMEROS LOS ESCRIBE `formatCurrency`, el mismo de la tabla de Movimientos.
 * Un gráfico que escriba los importes de otra forma que la tabla que tiene al
 * lado se lee como si fueran datos distintos.
 */
export function ChatChartView({ chart }: { chart: ChatChart }) {
  if (chart.points.length < 2) return null;

  return chart.type === "line" ? <LineChart chart={chart} /> : <BarChart chart={chart} />;
}

/**
 * Barras horizontales.
 *
 * La escala es relativa al MAYOR valor, no a un total: lo que se compara es
 * unos con otros. Con un máximo de cero —todos los valores a cero— se pintan
 * todas vacías en vez de dividir entre cero.
 */
function BarChart({ chart }: { chart: ChatChart }) {
  const max = Math.max(...chart.points.map((point) => Math.abs(point.value)));

  return (
    <ul className="flex w-full flex-col gap-2">
      {chart.points.map((point, index) => {
        const ancho = max > 0 ? (Math.abs(point.value) / max) * 100 : 0;

        return (
          <li key={`${point.label}-${index}`} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-zinc-600 dark:text-zinc-400">
                {point.label}
              </span>
              <span className="shrink-0 font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatValue(point.value, chart.unit)}
              </span>
            </div>

            {/* La barra es un div, no un SVG: para un rectángulo con ancho en
                porcentaje, el SVG no aporta nada y el div se adapta solo. */}
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
              role="img"
              aria-label={`${point.label}: ${formatValue(point.value, chart.unit)}`}
            >
              <div
                className={`h-full rounded-full ${
                  point.value < 0 ? "bg-red-400 dark:bg-red-500" : "bg-zinc-900 dark:bg-zinc-100"
                }`}
                style={{ width: `${ancho}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Alto del lienzo de la línea, en unidades del `viewBox`. */
const LINE_HEIGHT = 40;

/**
 * Línea de evolución.
 *
 * El eje vertical va del MENOR al MAYOR valor de la serie, no desde cero: con
 * importes que se mueven poco —tres meses entre 900 y 1000— una escala desde
 * cero dibujaría una recta plana que no dice nada. Lo que se quiere ver aquí es
 * la forma del cambio.
 *
 * Ese es también el motivo de que los valores vayan escritos debajo: una línea
 * sin escala desde cero puede exagerar visualmente una diferencia pequeña, así
 * que las cifras tienen que estar a la vista para no engañar.
 */
function LineChart({ chart }: { chart: ChatChart }) {
  const valores = chart.points.map((point) => point.value);
  const max = Math.max(...valores);
  const min = Math.min(...valores);
  const rango = max - min;

  const puntos = chart.points.map((point, index) => {
    const x = (index / (chart.points.length - 1)) * 100;
    // Sin rango —todos iguales— la línea va por el medio en vez de partir por
    // cero. `y` se invierte porque en SVG crece hacia abajo.
    const y = rango > 0 ? LINE_HEIGHT - ((point.value - min) / rango) * LINE_HEIGHT : LINE_HEIGHT / 2;
    return { x, y, point };
  });

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 100 ${LINE_HEIGHT}`}
        // `none`: el SVG se estira al ancho disponible sin conservar la
        // proporción, que es lo que se quiere en una tira de evolución.
        preserveAspectRatio="none"
        className="h-24 w-full"
        role="img"
        aria-label={`Evolución: ${chart.points
          .map((point) => `${point.label} ${formatValue(point.value, chart.unit)}`)
          .join(", ")}`}
      >
        <polyline
          points={puntos.map((punto) => `${punto.x},${punto.y}`).join(" ")}
          fill="none"
          className="stroke-zinc-900 dark:stroke-zinc-100"
          strokeWidth="1"
          // Sin esto, el trazo se deformaría al estirarse el viewBox y la línea
          // se vería más gruesa en horizontal que en vertical.
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {puntos.map((punto, index) => (
          <circle
            key={index}
            cx={punto.x}
            cy={punto.y}
            r="1.5"
            vectorEffect="non-scaling-stroke"
            className="fill-zinc-900 dark:fill-zinc-100"
          />
        ))}
      </svg>

      {/* Las etiquetas van fuera del SVG: dentro se estirarían con el
          `preserveAspectRatio="none"` y saldrían deformadas. */}
      <ul className="mt-1 flex justify-between gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
        {chart.points.map((point, index) => (
          <li key={`${point.label}-${index}`} className="min-w-0 truncate text-center">
            <span className="block truncate">{point.label}</span>
            <span className="block font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
              {formatValue(point.value, chart.unit)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Importe o recuento, según lo que mida la serie. */
function formatValue(value: number, unit: ChatChart["unit"]): string {
  return unit === "PEN" ? formatCurrency(value) : String(value);
}
