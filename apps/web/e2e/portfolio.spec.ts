import { expect, test, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildCas, buildOtherPdf, CLOSED_FUND, pickFunds } from "./synthetic-cas";

const ARTIFACTS = "test-results/artifacts";
mkdirSync(ARTIFACTS, { recursive: true });

const PASSWORD = "ABCPV1234K";
const funds = pickFunds();
const files = {
  plain: `${ARTIFACTS}/synthetic-cas.pdf`,
  encrypted: `${ARTIFACTS}/synthetic-cas-encrypted.pdf`,
  other: `${ARTIFACTS}/not-a-cas.pdf`,
};
let expected: Awaited<ReturnType<typeof buildCas>>["expected"];
const qpdf = spawnSync("qpdf", ["--version"]).status === 0;

test.beforeAll(async () => {
  const built = await buildCas(funds);
  expected = built.expected;
  writeFileSync(files.plain, built.pdf);
  writeFileSync(files.other, await buildOtherPdf());
  writeFileSync(
    `${ARTIFACTS}/synthetic-cas-expected.json`,
    JSON.stringify({ funds, expected }, null, 2),
  );
  if (qpdf) {
    const run = spawnSync("qpdf", [
      "--encrypt",
      PASSWORD,
      PASSWORD,
      "256",
      "--",
      files.plain,
      files.encrypted,
    ]);
    expect(run.status, run.stderr.toString()).toBe(0);
  }
});

const rupees = (v: number) =>
  `${v < 0 ? "-" : ""}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`;
const units = (v: number) =>
  v.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

async function open(page: Page, file: string, password = "") {
  await page.goto("/portfolio", { waitUntil: "networkidle" });
  await page.getByLabel("CAS PDF").setInputFiles(file);
  if (password) await page.getByLabel("Statement password").fill(password);
  await page.getByRole("button", { name: "Read statement" }).click();
}

// Next's route announcer is an empty alert of its own.
const formAlert = (page: Page) => page.locator("form").getByRole("alert");

const holdingRow = (page: Page, name: string) =>
  page.locator("tbody tr").filter({ has: page.getByText(name, { exact: true }) });

test("reads the statement, joins it to the data and computes the figures", async ({ page }) => {
  await open(page, files.plain);
  await expect(page.getByRole("heading", { name: "Holdings" })).toBeVisible();
  await expect(page.getByText(/Statement for ASHA VERMA, 1990-01-01 to 2026-10-15/)).toBeVisible();

  await expect(page.locator("tbody tr")).toHaveCount(expected.length);
  for (const scheme of expected) {
    const row = holdingRow(page, scheme.name);
    await expect(row, scheme.name).toHaveCount(1);
    await expect(row.locator("td").nth(1)).toHaveText(units(scheme.units));
  }

  // Funds in the data link to their pages and are valued at the site's latest NAV.
  const regular = expected.find((s) => s.isin === funds.regular.isin)!;
  const regularRow = holdingRow(page, funds.regular.name);
  await expect(regularRow.getByRole("link", { name: funds.regular.name })).toHaveAttribute(
    "href",
    new RegExp(`/fund/${funds.regular.code}/?$`),
  );
  await expect(regularRow.locator("td").nth(3)).toHaveText(
    rupees(regular.units * funds.regular.nav),
  );

  // The closed fund is valued from the statement and its XIRR is hand-checkable: 10,000 paid
  // (9,999.50 plus 0.50 stamp duty) grew to 11,000 in exactly 365 days.
  const closed = holdingRow(page, CLOSED_FUND.name);
  await expect(closed.getByText("Statement valuation")).toBeVisible();
  await expect(closed.locator("td").nth(3)).toHaveText("₹11,000");
  await expect(closed.locator("td").nth(6)).toHaveText("10.00%");

  // The regular plan's direct twin, and the rupee difference in their expense ratios.
  const gap = funds.regular.expenseRatio - funds.direct.expenseRatio;
  const direct = page
    .locator("section")
    .filter({ hasText: "Regular plans and their direct plans" });
  await expect(direct.getByRole("link", { name: funds.direct.name })).toBeVisible();
  await expect(
    direct.getByText(rupees(regular.units * funds.regular.nav * gap), { exact: true }),
  ).toBeVisible();

  // A regular plan and its own direct plan move alike, so the style check pairs them.
  const style = page.locator("section").filter({ hasText: "Funds with a similar style" });
  await expect(style.getByRole("link", { name: funds.direct.name })).toBeVisible();

  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/NaN|undefined|Infinity|\[object Object\]/);
});

test("reports a missing or wrong password, and opens with the right one", async ({ page }) => {
  test.skip(!qpdf, "qpdf is not installed, so no encrypted statement can be made");
  await open(page, files.encrypted);
  await expect(formAlert(page)).toContainText("password protected");
  await page.getByLabel("Statement password").fill("WRONG1234X");
  await page.getByRole("button", { name: "Read statement" }).click();
  await expect(formAlert(page)).toContainText("did not open");
  await page.getByLabel("Statement password").fill(PASSWORD);
  await page.getByRole("button", { name: "Read statement" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(expected.length);
  await expect(formAlert(page)).toHaveCount(0);
});

test("reports a PDF that is not a statement, and a file that is not a PDF", async ({ page }) => {
  await open(page, files.other);
  await expect(formAlert(page)).toContainText("not a CAMS/KFintech Consolidated Account Statement");
  await page.getByLabel("CAS PDF").setInputFiles({
    name: "statement.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not really a pdf"),
  });
  await page.getByRole("button", { name: "Read statement" }).click();
  await expect(formAlert(page)).toContainText("not a readable PDF");
});

test("fits a phone without sideways scroll, in both themes", async ({ browser }) => {
  for (const colorScheme of ["light", "dark"] as const)
    for (const [label, viewport] of [
      ["phone", { width: 390, height: 844 }],
      ["desktop", { width: 1366, height: 900 }],
    ] as const) {
      const page = await browser.newPage({ viewport, colorScheme });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      // A screenshot hides the caret with an inline style, which hydration would flag.
      await page.goto("/portfolio", { waitUntil: "networkidle" });
      await page.screenshot({
        path: `${ARTIFACTS}/portfolio-empty-${label}-${colorScheme}.png`,
        fullPage: true,
      });
      await page.getByLabel("CAS PDF").setInputFiles({
        name: "cas.pdf",
        mimeType: "application/pdf",
        buffer: readFileSync(files.plain),
      });
      await page.getByRole("button", { name: "Read statement" }).click();
      await expect(page.getByText("Funds with a similar style")).toBeVisible();
      await expect(page.getByText("Loading style estimates...")).toHaveCount(0);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${label} ${colorScheme} scrolls sideways`).toBeLessThanOrEqual(0);
      expect(errors, `${label} ${colorScheme}`).toEqual([]);
      await page.screenshot({
        path: `${ARTIFACTS}/portfolio-${label}-${colorScheme}.png`,
        fullPage: true,
      });
      await page.close();
    }
});
