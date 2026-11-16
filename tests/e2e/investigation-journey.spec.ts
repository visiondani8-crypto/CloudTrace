import { expect, signIn, test } from "./fixtures";

test("historical provider outage: evidence, dependency impact, hypothesis, report and exports", async ({ page }) => {
  await signIn(page, "analyst@cloudtrace.local");
  await expect(page.getByText("No live Microsoft tenant is connected")).toBeVisible();

  // Search and open the seeded case from the incident list.
  await page.goto("/incidents");
  await page.waitForLoadState("networkidle"); // let React hydrate before typing
  await page.getByLabel("Search", { exact: true }).fill("CT-2026-001");
  await expect(page).toHaveURL(/q=CT-2026-001/);
  await page.getByRole("link", { name: "Microsoft 365 / Exchange Online — Historical Provider Outage" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Historical Provider Outage/);
  await expect(page.getByText("Provider technical disruption").first()).toBeVisible();
  await expect(page.getByText(/Confirmed security incident/)).toHaveCount(0);
  await expect(page.getByText("PUBLIC REPORT + SIMULATED").first()).toBeVisible();
  const url = page.url();

  // Timeline sorted by observed time; inspector shows hash and provenance.
  await page.getByRole("tab", { name: /Timeline/ }).click();
  await expect(page).toHaveURL(/tab=timeline/);
  const times = await page.locator(".ct-timeline-time").allTextContents();
  expect([...times].sort()).toEqual(times);
  await page.getByRole("link", { name: /Inspect evidence EV-0003/ }).first().click();
  const drawer = page.locator("dialog.ct-drawer[open]");
  await expect(drawer.getByText("SHA-256 (canonical record)")).toBeVisible();
  await expect(drawer.getByText("Simulated company events. Not observed Microsoft tenant activity.", { exact: true })).toBeVisible();
  await expect(drawer.getByText("SYNTHETIC-CRM-001")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);

  // Dependency impact: confirmed vs at risk vs independent portal (list view).
  await page.getByRole("tab", { name: "Dependency impact" }).click();
  await page.getByRole("button", { name: "List" }).click();
  const row = (name: string) => page.locator("tr", { has: page.getByRole("button", { name: `Inspect ${name}` }) });
  await expect(row("CRM Email Sync")).toContainText("Confirmed affected");
  await expect(row("Outlook Mail Access")).toContainText("At risk");
  await expect(row("Azure-hosted Customer Portal")).toContainText("Unknown");
  await expect(row("Exchange Online")).toContainText("Provider reported");
  await page.getByRole("button", { name: "Inspect Finance Approval Workflow" }).click();
  await expect(page.getByLabel("Dependency path")).toContainText("Exchange Online");

  // New hypothesis with linked evidence persists after reload.
  await page.getByRole("tab", { name: /Hypotheses/ }).click();
  await page.getByRole("button", { name: "New hypothesis" }).click();
  const dialog = page.getByRole("dialog", { name: "New hypothesis" });
  await dialog.getByLabel("Statement").fill("Helpdesk timeouts share the provider outage window");
  await dialog.getByLabel("Status").selectOption("SUPPORTED");
  await dialog.getByRole("button", { name: "Save hypothesis" }).click();
  await expect(dialog.getByText("at least one supporting evidence item").first()).toBeVisible();
  await dialog.locator("fieldset", { hasText: "Supporting evidence" }).getByRole("checkbox").nth(3).check();
  await dialog.getByRole("button", { name: "Save hypothesis" }).click();
  await expect(page.getByRole("heading", { name: "Helpdesk timeouts share the provider outage window" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Helpdesk timeouts share the provider outage window" })).toBeVisible();

  // Rule-based analysis without an API key.
  await page.getByRole("button", { name: "Analyze evidence" }).first().click();
  await expect(page.getByText("Rule-based analysis saved.")).toBeVisible();

  // Generate v2; v1 stays unchanged.
  await page.goto(`${url.split("?")[0]}?tab=report`);
  const v1Hash = await page.locator("dd.ct-mono.break-all").first().textContent();
  await page.getByRole("button", { name: "Generate new version" }).click();
  await expect(page.getByText("Report v2 generated as an immutable snapshot.")).toBeVisible();
  await expect(page.getByRole("link", { name: /^v2 ·/ })).toBeVisible();
  await page.getByRole("link", { name: /^v1 ·/ }).click();
  await expect(page.locator("dd.ct-mono.break-all").first()).toHaveText(v1Hash!);

  // Exports produce real data.
  const reportId = new URL(page.url()).searchParams.get("report")!;
  const json = await page.evaluate(async (id) => {
    const res = await fetch(`/api/reports/${id}/export?format=json`);
    return { type: res.headers.get("content-type"), body: await res.json() };
  }, reportId);
  expect(json.type).toContain("application/json");
  expect(json.body.report.version).toBe(1);
  expect(json.body.report.dataNotice.containsSimulated).toBe(true);
  const csv = await page.evaluate(async (id) => {
    const res = await fetch(`/api/reports/${id}/export?format=csv`);
    return { type: res.headers.get("content-type"), disposition: res.headers.get("content-disposition"), text: await res.text() };
  }, reportId);
  expect(csv.type).toContain("text/csv");
  expect(csv.disposition).toContain("attachment");
  expect(csv.text.split("\r\n")[0]).toContain('"occurred_at_utc"');
  expect(csv.text).toContain("SIMULATED");

  // Print view has no app shell.
  await page.goto(`/reports/${reportId}/print`);
  await expect(page.getByRole("heading", { name: "1. Incident identification" })).toBeVisible();
  await expect(page.locator("#ct-sidebar")).toHaveCount(0);
});

test("create an incident, change status and find it after refresh", async ({ page }) => {
  await signIn(page, "analyst@cloudtrace.local");
  await page.goto("/incidents");
  await page.getByRole("button", { name: "Create incident" }).click();
  const dialog = page.getByRole("dialog", { name: "Create incident" });
  await dialog.getByRole("button", { name: "Create incident" }).click();
  await expect(dialog.getByText("Title must be at least 3 characters.")).toBeVisible();
  await dialog.getByLabel("Title").fill("E2E portal sign-in latency");
  await dialog.getByLabel("Description").fill("Customers report slow sign-in on the portal. Cause unknown.");
  await dialog.getByLabel("Type").selectOption("CONFIGURATION_FAILURE");
  await dialog.getByRole("button", { name: "Create incident" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E portal sign-in latency");
  await page.getByLabel("Status").selectOption("INVESTIGATING");
  await expect(page.getByText(/Status changed to Investigating/)).toBeVisible();
  await page.reload();
  await expect(page.locator(".ct-tag", { hasText: "Investigating" }).first()).toBeVisible();
  await page.goto("/incidents?status=INVESTIGATING");
  await expect(page.getByRole("link", { name: "E2E portal sign-in latency" }).first()).toBeVisible();
  await page.goto("/activity?action=incident");
  await expect(page.getByText(/status Open → Investigating/).first()).toBeVisible();
});
