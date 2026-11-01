import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";

const ARTIFACTS = "test-results/artifacts";
mkdirSync(ARTIFACTS, { recursive: true });

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${ARTIFACTS}/${name}.png`, fullPage: true });

const fundCount = async (page: Page) => {
  const text = await page.getByText(/\d+ funds? match/).innerText();
  return Number(/(\d+) funds? match/.exec(text)![1]);
};

type Fund = { name: string; code: string };

/**
 * A fund that has a page. A sample export (`make static-export LIMIT=n`) publishes pages
 * for only some schemes, so a fund taken from a screen may have none.
 */
function publishedFund(): Fund {
  const file = readdirSync("public/data/fund").find((name) => name.endsWith(".json"))!;
  const bundle = JSON.parse(readFileSync(`public/data/fund/${file}`, "utf8"));
  return { code: file.replace(".json", ""), name: bundle.scheme.scheme.scheme_name };
}

/**
 * Two funds from the live store, so the specs run on the sample data and the full one
 * alike. Taken from the ten-year preset because a basket needs funds with shared history.
 */
async function topFunds(page: Page): Promise<[Fund, Fund]> {
  await page.goto("/screener?preset=long-term-consistency");
  const links = page.locator("tbody tr a[href^='/fund/']");
  await expect(links.nth(1)).toBeVisible();
  const read = async (i: number) => ({
    name: (await links.nth(i).innerText()).trim(),
    code: (await links.nth(i).getAttribute("href"))!.split("/").filter(Boolean).pop()!,
  });
  return [await read(0), await read(1)];
}

test("every page renders without errors, broken values or sideways scroll", async ({ browser }) => {
  const fund = publishedFund();
  const paths = [
    "/",
    "/screener",
    "/compare",
    "/basket",
    "/overlap",
    "/benchmarks",
    "/data-status",
    "/glossary",
    "/methodology",
    `/fund/${fund.code}/`,
  ];
  for (const [label, viewport] of [
    ["desktop", { width: 1366, height: 900 }],
    ["phone", { width: 390, height: 844 }],
  ] as const) {
    const page = await browser.newPage({ viewport });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    for (const path of paths) {
      await page.goto(path, { waitUntil: "networkidle" });
      expect(errors, `${label} ${path}`).toEqual([]);
      // A rendering bug shows up as a bare token where a value belongs; "undefined" in
      // prose (the methodology says a zero-denominator ratio "is undefined") is fine.
      const body = await page.locator("main").innerText();
      expect(body, `${label} ${path}`).not.toMatch(/NaN|\[object Object\]|^(undefined|null)$/m);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${label} ${path} scrolls sideways`).toBeLessThanOrEqual(0);
      await shot(page, `${label}-${path.replace(/\W+/g, " ").trim().replace(/ /g, "-") || "home"}`);
    }
    await page.close();
  }
});

test("an unknown fund is a 404 page, not a crash", async ({ page }) => {
  const response = await page.goto("/fund/999999999/");
  expect(response?.status()).toBe(404);
});

test("a fund page has its own title and loads its figures in the browser", async ({ page }) => {
  const fund = publishedFund();
  await page.goto(`/fund/${fund.code}/`);
  await expect(page).toHaveTitle(`${fund.name}: returns, risk and peers`);
  await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(fund.name);
  for (const card of ["Trailing returns", "Peer comparison"]) {
    await expect(page.getByRole("heading", { name: card, exact: true })).toBeVisible();
  }
  await shot(page, "fund");
});

test("header search opens the chosen fund", async ({ page }) => {
  const fund = publishedFund();
  await page.goto("/");
  const search = page.getByRole("banner").getByRole("combobox");
  await search.fill(fund.name);
  await page.getByRole("option").filter({ hasText: fund.name }).first().click();
  await expect(page).toHaveURL(`/fund/${fund.code}/`);
  await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(fund.name);
});

test("a preset narrows the screen and the CSV export holds exactly those funds", async ({
  page,
}) => {
  await page.goto("/screener");
  const all = await fundCount(page);
  const preset = page.getByLabel("Preset screen");
  const firstPreset = await preset.locator("option").nth(1).getAttribute("value");
  await preset.selectOption(firstPreset!);
  await expect.poll(() => fundCount(page)).toBeLessThan(all);
  const narrowed = await fundCount(page);
  expect(narrowed).toBeGreaterThan(0);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export CSV" }).click(),
  ]);
  const path = `${ARTIFACTS}/${firstPreset}.csv`;
  await download.saveAs(path);
  const rows = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"));
  // One header row, then one row per fund.
  expect(rows.length - 1).toBe(narrowed);
  await shot(page, "screener-preset");
});

test("sorting a column reorders the rows", async ({ page }) => {
  await page.goto("/screener");
  const sort = page.getByRole("button", { name: "Sort by Past return per year (5Y)" });
  const header = page.getByRole("columnheader").filter({ has: sort });
  await expect(header).toHaveAttribute("aria-sort", "descending");
  const firstFund = () =>
    page.locator("tbody tr").first().locator("a[href^='/fund/']").getAttribute("href");
  const before = await firstFund();
  await sort.click();
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  await expect.poll(firstFund).not.toBe(before);
});

test("ticked screener rows open side by side in compare", async ({ page }) => {
  const funds = await topFunds(page);
  for (const f of funds) await page.getByLabel(`Select ${f.name}`).check();
  await page.getByRole("link", { name: "Compare 2 selected" }).click();
  await expect(page).toHaveURL(new RegExp(`/compare/\\?codes=${funds[0].code},${funds[1].code}`));
  for (const f of funds) {
    await expect(page.getByRole("columnheader", { name: f.name })).toBeVisible();
  }
  await shot(page, "compare");
});

test("basket weights are normalised and drive the blend", async ({ page }) => {
  const funds = await topFunds(page);
  await page.goto("/basket");
  const search = page.getByLabel("Search funds to add to the basket");
  for (const f of funds) {
    await search.fill(f.code);
    await page.getByRole("button", { name: f.name }).click();
  }
  await page.getByLabel(`Weight for ${funds[0].name}`).fill("3");
  await page.getByLabel(`Weight for ${funds[1].name}`).fill("1");
  // The blend is rescored on the server; its table only counts once it carries the new weights.
  const blend = page.getByRole("table").filter({ hasText: "Blended basket" });
  await expect(blend.getByRole("row").filter({ hasText: funds[0].name })).toContainText("75.00%");
  await expect(blend.getByRole("row").filter({ hasText: funds[1].name })).toContainText("25.00%");
  await expect(page.getByText("Scoring basket...")).toBeHidden();
  await shot(page, "basket");
});

test("overlap says why there is no figure instead of showing 0%", async ({ page }) => {
  await page.goto("/overlap/");
  const body = page.locator("main");
  await expect(body).toContainText("No holdings are loaded");
  await expect(body).not.toContainText(/\b0(\.0+)?% overlap/i);
  await shot(page, "overlap");
});
