import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next's tsconfig sets jsx: preserve; vitest (vite 8 / rolldown-oxc) must
  // compile the JSX itself since no framework plugin is in play here.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      // `server-only` throws outside React Server Components; stub it so
      // server modules stay importable under vitest.
      "server-only": path.resolve(
        import.meta.dirname,
        "test/server-only-stub.ts",
      ),
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
