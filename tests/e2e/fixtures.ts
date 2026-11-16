import { expect, test as base, type Page } from "@playwright/test";

export const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-demo-password-123";

export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/overview");
  await page.waitForLoadState("networkidle");
}

export async function caseId(page: Page, caseNumber: string, ownerEmail?: string): Promise<string> {
  void ownerEmail;
  return page.evaluate(async (cn) => {
    const res = await fetch(`/api/incidents?q=${encodeURIComponent(cn)}`);
    const json = await res.json();
    return json.items.find((i: { caseNumber: string }) => i.caseNumber === cn).id as string;
  }, caseNumber);
}

/** Fails the test on uncaught page errors (including React hydration errors). */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await use(errors);
      expect(errors, "uncaught page errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
