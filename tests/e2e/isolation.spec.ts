import { expect, test } from "@playwright/test";
import { signIn, state } from "./helpers";

test("an admin of tenant B can't reach tenant A's people through the UI", async ({ browser }) => {
  const b = await signIn(browser, state.b.people.admin.email);
  const res = await b.goto(`/admin/employees/${state.a.people.worker.employeeId}`);
  expect(res?.status()).toBe(404);
  const logs = await b.goto(`/logs?employee=${state.a.people.worker.employeeId}`);
  expect(logs?.status()).toBe(404);
  await b.goto("/admin/employees");
  await expect(b.getByText(state.a.people.worker.email)).toHaveCount(0);
  await expect(b.getByText(state.b.people.worker.email)).toBeVisible();
  await b.goto("/admin/audit");
  await expect(b.getByText("Worker a")).toHaveCount(0);
});
