/**
 * Aviso cuando el dashboard no puede leer de la base de datos.
 *
 * La causa casi siempre es la misma: faltan las variables de entorno o no se ha
 * ejecutado `sql/init.sql`. Se prefiere esto a una pantalla de error de Next.js
 * porque dice exactamente qué falta por hacer.
 *
 * El mensaje viene de `describeError`, que solo devuelve nombres de variables y
 * errores de PostgreSQL: nunca el valor de un secreto.
 */
export function SetupNotice({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-900/60 dark:bg-amber-950/30">
      <h2 className="font-semibold text-amber-900 dark:text-amber-200">
        No se pudo cargar la información
      </h2>

      <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">{message}</p>

      <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-amber-800 dark:text-amber-300">
        <li>
          Copia <code className="font-mono">.env.example</code> a{" "}
          <code className="font-mono">.env.local</code> y rellena los valores.
        </li>
        <li>
          Ejecuta <code className="font-mono">sql/init.sql</code> en el SQL Editor de Supabase.
        </li>
        <li>Reinicia el servidor de desarrollo.</li>
      </ol>
    </div>
  );
}
