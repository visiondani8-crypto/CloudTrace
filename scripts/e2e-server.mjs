/**
 * Starts an isolated production server for Playwright on a throwaway database
 * (prisma/e2e.db). Never touches the developer database.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const port = process.env.E2E_PORT ?? "3100";
const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: "file:./e2e.db",
  AUTH_SECRET: "e2e-only-secret-not-for-real-use-0123456789",
  NEXTAUTH_URL: `http://localhost:${port}`,
  DEMO_SEED_PASSWORD: process.env.E2E_PASSWORD ?? "e2e-demo-password-123",
  ALLOW_DEMO_SEED: "true",
  ANTHROPIC_API_KEY: "",
  MS_TENANT_ID: "",
  MS_CLIENT_ID: "",
  MS_CLIENT_SECRET: "",
};

for (const f of ["prisma/e2e.db", "prisma/e2e.db-journal"]) rmSync(f, { force: true });
execSync("npx prisma db push --skip-generate", { stdio: "inherit", env });
execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env });
if (!existsSync(".next/BUILD_ID")) execSync("npx next build", { stdio: "inherit", env });

const server = spawn("npx", ["next", "start", "-p", port], { stdio: "inherit", env });
const stop = () => server.kill("SIGTERM");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
server.on("exit", (code) => process.exit(code ?? 0));
