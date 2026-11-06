import { expect, test } from "@playwright/test";
import { db, signIn, state } from "./helpers";

function nextWeekday(offset: number) {
  const d = new Date(Date.now() + offset * 86400_000);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

test("leave: apply → manager notified and approves → employee notified", async ({ browser }) => {
  const day = nextWeekday(20);
  const w = await signIn(browser, state.a.people.worker.email);
  await w.goto("/leave");
  await w.getByLabel("From").fill(day);
  await w.getByLabel("To").fill(day);
  await expect(w.getByText("This uses 1 day.", { exact: false })).toBeVisible();
  await w.getByLabel("Reason").fill("E2E family function");
  await w.getByRole("button", { name: "Request leave" }).click();
  await expect(w.getByText("Leave requested.")).toBeVisible();

  const m = await signIn(browser, state.a.people.manager.email);
  await expect(m.locator("nav").first().getByRole("link", { name: /Notifications/ })).toContainText("1");
  await m.goto("/approvals");
  const item = m.locator("li", { hasText: "E2E family function" }).first();
  await item.getByRole("button", { name: "Approve" }).click();
  await expect(m.locator("li", { hasText: "E2E family function" })).toHaveCount(0);

  await w.goto("/notifications");
  await expect(w.getByText("Leave approved")).toBeVisible();
  const mail = await db.emailMessage.findFirst({ where: { toEmail: state.a.people.worker.email, subject: { contains: "Leave approved" } } });
  expect(mail?.status).toBe("SENT");
});

test("delegation: the covering manager sees and decides the team's requests", async ({ browser }) => {
  const w = await signIn(browser, state.a.people.worker.email);
  await w.goto("/requests");
  await w.getByLabel("Reason").fill("E2E deploy ran late");
  await w.getByRole("button", { name: "Request overtime" }).click();
  await expect(w.getByText("Overtime requested.")).toBeVisible();

  const cover = await signIn(browser, state.a.people.cover.email);
  await cover.goto("/approvals");
  await expect(cover.getByText("E2E deploy ran late")).toHaveCount(0);

  const m = await signIn(browser, state.a.people.manager.email);
  await m.goto("/approvals");
  await m.getByLabel("Send to").selectOption(state.a.people.cover.employeeId);
  await m.getByRole("button", { name: "Set up cover" }).click();
  await expect(m.getByText(/Cover set up/)).toBeVisible();

  await cover.reload();
  const item = cover.locator("li", { hasText: "E2E deploy ran late" }).first();
  await item.getByRole("button", { name: "Approve" }).click();
  await expect(cover.locator("li", { hasText: "E2E deploy ran late" })).toHaveCount(0);
  const ev = await db.auditEvent.findFirstOrThrow({ where: { tenantId: state.a.id, action: "overtime.approved" }, orderBy: { createdAt: "desc" } });
  expect(ev.after).toMatchObject({ right: "DELEGATE" });
});
