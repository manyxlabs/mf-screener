import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";

const ARTIFACTS = "test-results/artifacts";
mkdirSync(ARTIFACTS, { recursive: true });

// Real funds with history back to 2017, so the grandfathering and indexation paths both run.
const EQUITY = "122639"; // Parag Parikh Flexi Cap Fund - Direct Plan - Growth
const DEBT = "120692"; // ICICI Prudential Corporate Bond Fund - Direct Plan - Growth

const scheme = (code: string) =>
  JSON.parse(readFileSync(`public/data/fund/${code}.json`, "utf8")).scheme.scheme as {
    scheme_name: string;
    latest_nav: number;
  };

type Row = [side: "buy" | "sell", date: string, units: number, value: number, kind?: "amount"];

// NAVs close to each fund's published month-end NAV on those dates.
const EQUITY_ROWS: Row[] = [
  ["buy", "2017-06-30", 10_000, 21.05],
  ["buy", "2023-03-31", 5_000, 53.05],
  ["sell", "2024-06-28", 6_000, 81.94],
  ["sell", "2024-09-30", 7_000, 88.62],
  ["buy", "2025-06-30", 1_000, 92.9],
  ["sell", "2025-09-30", 2_500, 92.1],
];
const DEBT_ROWS: Row[] = [
  ["buy", "2021-03-31", 10_000, 23.51],
  ["buy", "2023-06-30", 5_000, 132_950, "amount"],
  ["sell", "2024-06-28", 4_000, 28.66],
  ["sell", "2025-06-30", 8_000, 31.35],
];

async function addFund(page: Page, code: string): Promise<Locator> {
  const { scheme_name } = scheme(code);
  await page.getByLabel("Search funds to add to the calculator").fill(scheme_name);
  await page.getByRole("button", { name: scheme_name }).first().click();
  return page.locator("section").filter({ has: page.getByRole("link", { name: scheme_name }) });
}

async function enter(card: Locator, rows: Row[]) {
  for (const [i, [side, date, units, value, kind]] of rows.entries()) {
    const n = i + 1;
    if (i > 0) await card.getByRole("button", { name: "+ Add a transaction" }).click();
    await card.getByLabel(`Row ${n} type`).selectOption(side);
    await card.getByLabel(`Row ${n} date`).fill(date);
    await card.getByLabel(`Row ${n} units`).fill(String(units));
    if (kind) await card.getByLabel(`Row ${n} value kind`).selectOption(kind);
    await card.getByLabel(`Row ${n} ${kind ? "amount" : "NAV"}`).fill(String(value));
  }
}

const stat = (year: Locator, label: string) =>
  year.locator("div.rounded-xl", { hasText: label }).locator("div.text-xl");

test("works out a multi-year set of trades and keeps them across a reload", async ({ page }) => {
  await page.goto("/capital-gains");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const equity = await addFund(page, EQUITY);
  await expect(equity.getByLabel(/Tax type/)).toHaveValue("equity");
  await enter(equity, EQUITY_ROWS);
  // The data's January 2018 NAV (24.6526) is offered for the 2017 purchase.
  await expect(equity.getByLabel(/31 Jan 2018 value/)).toHaveAttribute("placeholder", "24.6526");

  const debt = await addFund(page, DEBT);
  await expect(debt.getByLabel(/Tax type/)).toHaveValue("debt");
  await enter(debt, DEBT_ROWS);
  await page.getByLabel("Slab rate").fill("30");

  const check = async () => {
    // FY 2024-25.
    // Equity, sold 28 Jun 2024 (10%): 6,000 units bought 2017, cost raised by
    // grandfathering to 6,000 x 24.6526 = 1,47,915.60 against 4,91,640 = 3,43,724.40.
    // Sold 30 Sep 2024 (12.5%): 4,000 more 2017 units, 3,54,480 - 98,610.40 =
    // 2,55,869.60, and 3,000 units of Mar 2023, 2,65,860 - 1,59,150 = 1,06,710.
    // Debt, sold 28 Jun 2024: 4,000 units of Mar 2021, over 36 months, so 20% with
    // indexation: 94,040 x 363/301 = 1,13,410.37 against 1,14,640 = 1,229.63.
    // LTCG 7,07,533.63. The 1,25,000 exemption covers 12.5% gains first:
    // 2,37,579.60 x 12.5% + 3,43,724.40 x 10% + 1,229.63 x 20% = 64,315.82, plus 4% cess
    // = 66,888.45.
    const fy24 = page.getByTestId("fy-2024-25");
    await expect(stat(fy24, "Short-term gains")).toHaveText("₹0");
    await expect(stat(fy24, "Long-term gains")).toHaveText("₹7,07,534");
    await expect(stat(fy24, "exemption used")).toHaveText("₹1,25,000");
    await expect(stat(fy24, "Estimated tax")).toHaveText("₹66,888");

    // FY 2025-26.
    // Equity, sold 30 Sep 2025: the last 2,000 Mar 2023 units, 1,84,200 - 1,06,100 =
    // 78,100 long-term, then 500 of Jun 2025, 46,050 - 46,450 = -400 short-term.
    // Debt, sold 30 Jun 2025: 6,000 Mar 2021 units, over 24 months, 1,88,100 - 1,41,060 =
    // 47,040 at 12.5%; 2,000 Jun 2023 units are a specified fund's, 62,700 - 53,180 =
    // 9,520 at the slab rate. The 400 loss meets the 30% slab gain first: 9,120.
    // 78,100 is inside the exemption. 47,040 x 12.5% + 9,120 x 30% = 8,616, plus 4% cess
    // = 8,960.64.
    const fy25 = page.getByTestId("fy-2025-26");
    await expect(stat(fy25, "Short-term gains")).toHaveText("₹9,120");
    await expect(stat(fy25, "Long-term gains")).toHaveText("₹1,25,140");
    await expect(stat(fy25, "exemption used")).toHaveText("₹78,100");
    await expect(stat(fy25, "Estimated tax")).toHaveText("₹8,961");

    // Left: 500 equity units of Jun 2025 and 3,000 debt units of Jun 2023.
    const open = page.getByTestId("open-lots");
    await expect(open.locator("tbody tr")).toHaveCount(2);
    const equityValue = 500 * scheme(EQUITY).latest_nav;
    await expect(open.locator("tbody tr").first()).toContainText(
      `₹${Math.round(equityValue).toLocaleString("en-IN")}`,
    );
    await expect(open.locator("tbody tr").nth(1)).toContainText("Never: always short-term");
  };
  await check();
  await expect(page.getByTestId("lots")).toContainText("₹1,47,916");

  await page.reload();
  await check();
});

test("fits a phone and both themes", async ({ browser }) => {
  for (const [label, viewport] of [
    ["phone", { width: 390, height: 844 }],
    ["desktop", { width: 1366, height: 900 }],
  ] as const) {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("/capital-gains");
      await page.evaluate((t) => {
        localStorage.clear();
        localStorage.setItem("mf-theme", t);
      }, theme);
      await page.reload();
      await enter(await addFund(page, EQUITY), EQUITY_ROWS);
      await enter(await addFund(page, DEBT), DEBT_ROWS);
      await page.getByLabel("Slab rate").fill("30");
      await expect(page.getByTestId("fy-2024-25")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${label} ${theme} scrolls sideways`).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
      await page.screenshot({
        path: `${ARTIFACTS}/capital-gains-${label}-${theme}.png`,
        fullPage: true,
      });
      await page.close();
    }
  }
});
