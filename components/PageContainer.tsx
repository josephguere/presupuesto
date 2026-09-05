/**
 * Ancho de cada pantalla.
 *
 * La decisión vive aquí y no en el layout raíz porque las pantallas no quieren
 * lo mismo: un panel de tarjetas se lee mejor centrado y estrecho, y una tabla
 * de doce columnas necesita todo el ancho que haya.
 *
 * Antes el tope estaba en `<main>`, compartido por todas, y era justo lo que
 * obligaba a la tabla de Movimientos a desplazarse en horizontal: la tabla se
 * enciende a 1024 px y el contenedor topaba en esos mismos 1024 px.
 *
 * El tope de 1800 px no es decorativo. Sin él, en un monitor 4K una fila mide
 * más de dos mil píxeles y seguir con la vista la línea que va de la fecha al
 * monto se vuelve incómodo.
 */
export function PageContainer({
  wide = false,
  className = "",
  children,
}: {
  /** `true` en las pantallas de tabla completa: Movimientos y Eliminados. */
  wide?: boolean;
  /** Se fusiona con el ancho, para sustituir al div raíz sin anidar otro. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`mx-auto w-full ${wide ? "max-w-[1800px]" : "max-w-5xl"} ${className}`}>
      {children}
    </div>
  );
}
