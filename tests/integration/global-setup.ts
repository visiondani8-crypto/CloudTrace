import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

/** Creates a fresh SQLite schema for the integration tests (prisma/test.db). */
export default function setup() {
  for (const f of ["prisma/test.db", "prisma/test.db-journal"]) rmSync(f, { force: true });
  execSync("npx prisma db push --skip-generate", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
  });
  return () => {
    for (const f of ["prisma/test.db", "prisma/test.db-journal"]) rmSync(f, { force: true });
  };
}
