import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // `server-only` throws outside the React Server Components runtime.
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    env: {
      DATABASE_URL: "file:./test.db",
      AUTH_SECRET: "test-secret-test-secret-test-secret-123",
      ANTHROPIC_API_KEY: "",
      MS_TENANT_ID: "",
      MS_CLIENT_ID: "",
      MS_CLIENT_SECRET: "",
    },
    // Integration tests share one SQLite test database.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
