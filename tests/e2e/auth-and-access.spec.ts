import { caseId, expect, signIn, test } from "./fixtures";

test("unauthenticated users are sent to sign-in and APIs return 401", async ({ page, request }) => {
  await page.goto("/incidents");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fincidents/);
  const res = await request.get("/api/incidents");
  expect(res.status()).toBe(401);
});

test("wrong password fails with a generic message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@cloudtrace.local");
  await page.getByLabel("Password", { exact: true }).fill("definitely-wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Email or password is incorrect" })).toBeVisible();
});

test("viewer is read-only in the UI and blocked by the server", async ({ page }) => {
  await signIn(page, "viewer@cloudtrace.local");
  await expect(page.getByRole("button", { name: "Create incident" })).toHaveCount(0);
  const id = await caseId(page, "CT-2026-001");
  await page.goto(`/investigations/${id}`);
  await expect(page.getByText("Your role allows viewing, not editing.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Analyze evidence" })).toHaveCount(0);
  const statuses = await page.evaluate(async (incidentId) => {
    const post = (url: string, body: unknown, method = "POST") =>
      fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.status);
    return [
      await post("/api/incidents", { title: "Viewer case", description: "x", type: "OTHER", severity: "LOW" }),
      await post(`/api/incidents/${incidentId}`, { severity: "LOW" }, "PATCH"),
      await post(`/api/incidents/${incidentId}/notes`, { text: "viewer note" }),
      await post(`/api/incidents/${incidentId}/analyze`, {}),
      await post(`/api/incidents/${incidentId}/reports`, {}),
      await post("/api/assets", { name: "Viewer asset", provider: "OTHER", assetType: "x", criticality: "LOW" }),
    ];
  }, id);
  expect(statuses).toEqual([403, 403, 403, 403, 403, 403]);
  await page.goto("/activity");
  await expect(page.getByText("You do not have permission to view the audit log.")).toBeVisible();
});

test("records from another organisation are not reachable by URL or ID", async ({ page }) => {
  await signIn(page, "isolation.owner@cloudtrace.local");
  const harborId = await caseId(page, "CT-2026-001");
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL("**/login**");

  await signIn(page, "owner@cloudtrace.local");
  const apiStatus = await page.evaluate(async (id) => (await fetch(`/api/incidents/${id}`)).status, harborId);
  expect(apiStatus).toBe(404);
  await page.goto(`/investigations/${harborId}`);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByText("Harbor isolation fixture")).toHaveCount(0);
});
