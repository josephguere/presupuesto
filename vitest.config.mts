import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Mismo alias que tsconfig.json, para que los tests importen igual que la app.
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // `.tsx` para las pruebas que renderizan componentes a HTML con
    // `renderToStaticMarkup` y comprueban qué se ve y qué se puede editar.
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
