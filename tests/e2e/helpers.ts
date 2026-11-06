import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { STATE_FILE } from "./global-setup";

type People = Record<"admin" | "manager" | "cover" | "worker" | "newbie", { email: string; employeeId: string; userId: string }>;
export const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { password: string; a: { id: string; people: People }; b: { id: string; people: People } };

export const OFFICE_IP = "10.20.30.40";
export const HOME_IP = "49.36.10.20";

export const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

/** A signed-in page whose requests appear to come from `ip`. */
export async function signIn(browser: Browser, email: string, opts: { ip?: string; password?: string } = {}): Promise<Page> {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": opts.ip ?? OFFICE_IP } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(opts.password ?? state.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return page;
}

export async function expectNoErrorBoundary(page: Page) {
  await expect(page.getByText("Application error")).toHaveCount(0);
}

// Each test opens several signed-in contexts; close them so later tests start clean.
test.afterEach(async ({ browser }) => {
  for (const c of browser.contexts()) await c.close();
});
