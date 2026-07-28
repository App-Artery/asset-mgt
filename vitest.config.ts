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
    // Integration tests share one real test database, and the last-admin
    // guard counts active admins across the whole User table — files that
    // create ADMIN_IT rows while another file stages a "last admin" scenario
    // would race. Run test files sequentially; the suite is small.
    fileParallelism: false,
  },
});
