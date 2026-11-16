import AxeBuilder from "@axe-core/playwright";
import { caseId, expect, signIn, test } from "./fixtures";

const HEADER = "incidentCaseNumber,observedAt,title,category,sourceName,sourceEventId,assetName,provenance,contentText,sourceUri";

test("evidence import wizard validates rows and imports atomically", async ({ page }) => {
  await signIn(page, "analyst@cloudtrace.local");
  await page.goto("/evidence");
  await page.getByRole("button", { name: "Import evidence" }).click();
  const dialog = page.getByRole("dialog", { name: "Import CSV/JSON" });
  const id = await caseId(page, "CT-2026-003");
  await dialog.getByLabel(/Target incident/).selectOption(id);

  const invalid = [HEADER, "CT-2026-003,2026-11-15 11:00,Local time row,APP_LOG,E2E,E2E-1,,SYNTHETIC,x,", "CT-2026-003,2026-11-15T11:01:00Z,Good row,APP_LOG,E2E,E2E-2,,SYNTHETIC,<script>alert(1)</script>,"].join("\n");
  await dialog.locator("#import-file").setInputFiles({ name: "e2e-invalid.csv", mimeType: "text/csv", buffer: Buffer.from(invalid) });
  await expect(dialog.getByText(/time zone/).first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Import 1 valid row/ })).toBeDisabled();

  const valid = [HEADER, "CT-2026-003,2026-11-15T11:01:00Z,E2E gateway probe,HEALTH_EVENT,E2E probe,E2E-OK-1,Portal API Gateway,SYNTHETIC,<script>alert(1)</script> probe ok,"].join("\n");
  await dialog.locator("#import-file").setInputFiles({ name: "e2e-valid.csv", mimeType: "text/csv", buffer: Buffer.from(valid) });
  await expect(dialog.getByText("1 valid", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: /Import 1 valid row/ }).click();
  await expect(dialog.getByText(/Import completed: 1 accepted, 0 rejected/)).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();

  await page.goto("/evidence?q=E2E-OK-1");
  await page.getByRole("link", { name: /Inspect evidence EV-/ }).first().click();
  const drawer = page.locator("dialog.ct-drawer[open]");
  await expect(drawer.locator("pre.ct-code")).toContainText("<script>alert(1)</script> probe ok");
  expect(await page.evaluate(() => document.querySelectorAll("dialog.ct-drawer script").length)).toBe(0);
});

for (const [width, height] of [
  [390, 844],
  [768, 1024],
  [1440, 900],
] as const) {
  test(`layout at ${width}px has no horizontal body overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await signIn(page, "owner@cloudtrace.local");
    const id = await caseId(page, "CT-2026-001");
    for (const path of ["/overview", "/incidents", `/investigations/${id}`, `/investigations/${id}?tab=dependency`, "/evidence", "/assets", "/reports", "/integrations", "/activity", "/settings"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
    }
    if (width < 768) {
      const toggle = page.getByRole("button", { name: "Open navigation" });
      await toggle.click();
      await expect(page.locator("#ct-sidebar")).toHaveAttribute("data-open", "true");
      await page.getByRole("link", { name: "Incidents" }).click();
      await expect(page).toHaveURL(/\/incidents$/);
      await expect(page.locator("#ct-sidebar")).toHaveAttribute("data-open", "false");
    } else {
      await page.goto("/overview");
      await expect(page.getByRole("button", { name: "Create incident" })).toBeVisible();
    }
  });
}

test("key screens have no critical accessibility violations", async ({ page }) => {
  await signIn(page, "owner@cloudtrace.local");
  const id = await caseId(page, "CT-2026-001");
  for (const path of ["/overview", "/incidents", `/investigations/${id}`, `/investigations/${id}?tab=timeline`, "/evidence", "/integrations", "/settings"]) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude(".react-flow").analyze();
    const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    expect(blocking.map((v) => `${path}: ${v.id} (${v.nodes.length}) ${v.help}`)).toEqual([]);
  }
});
