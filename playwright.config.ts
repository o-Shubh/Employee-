import { defineConfig, devices } from "@playwright/test";

try {
  process.loadEnvFile(".env");
} catch {
  /* CI provides env */
}
const PORT = Number(process.env.E2E_PORT ?? 3100);
const DB = process.env.DATABASE_URL_TEST;
if (!DB) throw new Error("DATABASE_URL_TEST is required for e2e tests");

/**
 * End-to-end tests against a production build. Every run creates fresh tenants in
 * the TEST database (tests/e2e/global-setup.ts), so runs never collide.
 * The server trusts 2 proxy hops, so tests can choose their client IP with
 * X-Forwarded-For (office network vs home).
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1360, height: 900 },
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: DB,
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-secret-0123456789abcdef0123456789",
      AUTH_TRUST_HOST: "true",
      TRUST_PROXY_HOPS: "2",
      APP_URL: `http://localhost:${PORT}`,
      STORAGE_DIR: "./storage-test",
      DISABLE_SCHEDULER: "1",
      MAIL_LOG: "0",
      MAIL_TRANSPORT: "log",
    },
  },
});
