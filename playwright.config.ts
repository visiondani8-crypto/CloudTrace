import { defineConfig, devices } from "@playwright/test";

const port = process.env.E2E_PORT ?? "3100";

/**
 * End-to-end tests run against a production build (`npm run build` first) on an
 * isolated database. Usage: npm run build && npm run test:e2e
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `http://localhost:${port}/login`,
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: "pipe",
  },
});
