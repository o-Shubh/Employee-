import { execSync } from "node:child_process";

export default function setup() {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* env from CI */
  }
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST is not set");
  if (!/test/i.test(url)) throw new Error("Refusing to run tests against a database whose URL doesn't contain 'test'");
  // Non-destructive: apply pending migrations. Tests never truncate; every test
  // creates its own uniquely-named tenants, which is itself an isolation check.
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
