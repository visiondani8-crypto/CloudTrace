/**
 * DEVELOPMENT ONLY — destroys the local SQLite database and recreates the schema.
 * Run `npm run db:seed` afterwards to load the demo scenarios.
 */
import { execSync } from "node:child_process";

try {
  process.loadEnvFile(".env");
} catch {
  /* optional */
}

const url = process.env.DATABASE_URL ?? "";
if (process.env.NODE_ENV === "production") {
  console.error("db:reset is a development-only command and refuses to run with NODE_ENV=production.");
  process.exit(1);
}
if (!url.startsWith("file:")) {
  console.error(`db:reset only resets local SQLite databases (DATABASE_URL must start with "file:"). Refusing.`);
  process.exit(1);
}
console.warn("WARNING: development-only reset. All local CloudTrace data in", url, "will be deleted.");
execSync("npx prisma db push --force-reset --skip-generate", { stdio: "inherit" });
console.warn("Database reset. Run `npm run db:seed` to load the demo data.");
