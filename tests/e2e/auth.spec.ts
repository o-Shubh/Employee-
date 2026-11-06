import { expect, test } from "@playwright/test";
import { db, signIn, state } from "./helpers";

test("first sign-in: forced password change, then the privacy notice", async ({ browser }) => {
  const p = state.a.people.newbie;
  const page = await signIn(browser, p.email);
  await expect(page).toHaveURL(/change-password/);
  await page.getByLabel("Current (or temporary) password").fill(state.password);
  await page.getByLabel("New password", { exact: true }).fill("Newbie-Passw0rd-1");
  await page.getByLabel("Confirm new password").fill("Newbie-Passw0rd-1");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page).toHaveURL(/consent/);
  await expect(page.getByRole("heading", { name: /how your data is used/ })).toBeVisible();
  await page.getByRole("button", { name: "I have read this notice and agree" }).click();
  await expect(page).toHaveURL(/dashboard/);
  expect(await db.consentRecord.count({ where: { userId: p.userId } })).toBe(1);
});

test("forgot password: emailed link resets it and signs out other sessions", async ({ browser }) => {
  const p = state.a.people.cover;
  const oldSession = await signIn(browser, p.email);
  await expect(oldSession).toHaveURL(/dashboard/);

  const anon = await (await browser.newContext()).newPage();
  await anon.goto("/login");
  await anon.getByRole("link", { name: "Forgot your password?" }).click();
  await anon.waitForURL(/forgot-password/);
  await anon.getByLabel("Email").fill(p.email);
  await anon.getByRole("button", { name: "Send reset link" }).click();
  await expect(anon.getByText(/reset link is on its way/)).toBeVisible();

  const mail = await db.emailMessage.findFirstOrThrow({ where: { toEmail: p.email, subject: { contains: "Reset" } }, orderBy: { createdAt: "desc" } });
  const link = /http\S+reset-password\?token=\S+/.exec(mail.text)![0];
  await anon.goto(link);
  await anon.getByLabel("New password", { exact: true }).fill("Cover-Passw0rd-2");
  await anon.getByLabel("Confirm new password").fill("Cover-Passw0rd-2");
  await anon.getByRole("button", { name: "Save password" }).click();
  await expect(anon).toHaveURL(/dashboard/);

  // The session opened before the reset is no longer valid.
  await oldSession.reload();
  await expect(oldSession).toHaveURL(/login/);
  // Reusing the link fails.
  await anon.goto(link);
  await anon.getByLabel("New password", { exact: true }).fill("Another-Passw0rd-3");
  await anon.getByLabel("Confirm new password").fill("Another-Passw0rd-3");
  await anon.getByRole("button", { name: "Save password" }).click();
  await expect(anon.getByText(/expired or was already used/)).toBeVisible();
  // restore the shared password for later specs
  await db.user.update({ where: { id: p.userId }, data: { passwordHash: (await db.user.findUniqueOrThrow({ where: { id: state.a.people.admin.userId } })).passwordHash } });
});
