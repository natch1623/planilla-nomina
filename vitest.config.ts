import { defineConfig } from "vitest/config"
import path from "node:path"

/**
 * Configuración propia, separada de `vite.config.ts`.
 *
 * La config de Vite la administra Figma Make y trae sus plugins de preview y
 * de overlay de errores, que no aportan nada a una prueba unitaria y sí pueden
 * romperla. Las pruebas cubren funciones puras de `src/utils`, así que basta
 * con el alias `@` y el entorno de Node.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
