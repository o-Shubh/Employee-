import { expect, test } from "@playwright/test";
import { HOME_IP, db, signIn, state } from "./helpers";

test("register computer → admin approves → a full day → certify", async ({ browser }) => {
  const w = state.a.people.worker;
  const page = await signIn(browser, w.email);
  const main = page.locator("main");

  await main.getByRole("button", { name: "Check in" }).click();
  await expect(page.locator("main [role=alert], aside [role=alert]")).toContainText("isn't registered");

  await page.goto("/device");
  await page.getByLabel("Computer name").fill("E2E desk");
  await page.getByRole("button", { name: "Request approval" }).click();
  await expect(page.getByText(/waiting for administrator approval/)).toBeVisible();

  const admin = await signIn(browser, state.a.people.admin.email);
  await admin.goto("/admin/devices");
  await admin.locator("li", { hasText: "E2E desk" }).getByRole("button", { name: "Approve" }).click();
  await expect(admin.locator("li", { hasText: "E2E desk" })).toHaveCount(0);

  await page.goto("/dashboard");
  await main.getByRole("button", { name: "Check in" }).click();
  await expect(main.getByText("On duty", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Take a break" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Tea" }).click();
  await expect(main.getByText("Tea break")).toBeVisible();
  await main.getByRole("button", { name: "End break" }).click();
  await expect(main.getByText("On duty", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Check out" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Check out" }).click();
  await expect(main.getByText("Off duty", { exact: true })).toBeVisible();

  await page.getByRole("textbox").first().fill("Prepared the e2e report.");
  await page.getByLabel("I certify this log is accurate.").check();
  await page.getByRole("button", { name: "Certify log" }).click();
  await expect(page.getByText(/is certified/)).toBeVisible();

  const entries = await db.logEntry.findMany({ where: { employeeId: w.employeeId }, orderBy: { occurredAt: "asc" } });
  expect(entries.map((e) => e.type)).toEqual(["CHECK_IN", "BREAK", "ON_DUTY", "CHECK_OUT"]);
  expect(entries.every((e) => e.ip === "10.20.30.40")).toBe(true);
});

test("check-in from outside the office network is refused and audited", async ({ browser }) => {
  const page = await signIn(browser, state.a.people.manager.email, { ip: HOME_IP });
  await page.locator("main").getByRole("button", { name: "Check in" }).click();
  await expect(page.locator("main [role=alert], aside [role=alert]")).toContainText("not on the office network");
  const ev = await db.auditEvent.findFirst({ where: { subjectEmployeeId: state.a.people.manager.employeeId, action: "attendance.denied" }, orderBy: { createdAt: "desc" } });
  expect(ev).toMatchObject({ reason: "IP_NOT_ALLOWED", ip: HOME_IP });
});
