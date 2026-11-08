import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { makeI18n } from "../src/lib/i18n/core";
import { LANGUAGES, LOCALES, PREFIXED_LOCALES, type Locale } from "../src/lib/i18n/locales";
import bn from "../src/messages/bn";
import en, { type Messages } from "../src/messages/en";
import gu from "../src/messages/gu";
import hi from "../src/messages/hi";
import kn from "../src/messages/kn";
import ml from "../src/messages/ml";
import mr from "../src/messages/mr";
import ta from "../src/messages/ta";
import te from "../src/messages/te";

const ARTIFACTS = "test-results/artifacts/i18n";
mkdirSync(ARTIFACTS, { recursive: true });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://screener.manyxlabs.com";

// Pages with their own copy in every language; fund pages are translated in place instead.
const PAGES = [
  "/",
  "/screener/",
  "/category/",
  "/compare/",
  "/basket/",
  "/portfolio/",
  "/capital-gains/",
  "/overlap/",
  "/glossary/",
  "/methodology/",
  "/benchmarks/",
  "/data-status/",
];

// Imported here rather than through LANGUAGES[...].load(): the test runner's module
// interop wraps a dynamic import's default export a second time.
const CATALOGUES: Record<Locale, Messages> = { en, hi, bn, mr, te, ta, gu, kn, ml };

/** Every plain string of a catalogue, by its path; functions need values to say anything. */
function leaves(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => leaves(v, `${path}.${k}`));
  return [];
}

/**
 * English UI text that has its own wording in `locale`: seeing one on that language's page
 * means a string escaped the catalogue. Short values are left out, because one or two words
 * of English also occur inside fund and AMC names that rightly stay English. `held` is the
 * wording shown in English until a native speaker reviews it, which a page may quote a
 * leak candidate inside, so it is removed from the page's text before the scan.
 */
function wording(locale: Locale) {
  const i18n = makeI18n(locale, CATALOGUES[locale]);
  const shown = new Map(leaves(i18n.t));
  const translated = new Map(leaves(CATALOGUES[locale]));
  const ui = leaves({ ...en, data: undefined });
  const keys = Object.keys(i18n.t.data).filter((key) => !key.includes("{"));
  const leaks = [
    ...ui.filter(([path, text]) => shown.get(path) !== text).map(([, text]) => text),
    ...keys.filter((key) => i18n.td(key) !== key),
  ].filter((text) => text.split(/\s+/).length >= 3 && text.length >= 16);
  const held = [
    ...ui.filter(([path, text]) => shown.get(path) === text && translated.get(path) !== text),
    ...keys.filter((key) => i18n.td(key) === key && i18n.t.data[key] !== key).map((k) => [k, k]),
  ]
    .map(([, text]) => text!)
    .sort((a, b) => b.length - a.length);
  return { leaks, held };
}

function publishedFund(): { code: string; name: string } {
  const file = readdirSync("public/data/fund").find((name) => name.endsWith(".json"))!;
  const bundle = JSON.parse(readFileSync(`public/data/fund/${file}`, "utf8"));
  return { code: file.replace(".json", ""), name: bundle.scheme.scheme.scheme_name };
}

/** Text that runs past its box: a button, tab, heading or cell too narrow for its words. */
const clipped = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button, h1, h2, h3, th, label, [role=tab], a")]
      .filter((el) => {
        const style = getComputedStyle(el);
        if (style.display === "inline" || style.textOverflow === "ellipsis") return false;
        const box = el.getBoundingClientRect();
        return box.width > 0 && el.scrollWidth > el.clientWidth + 1;
      })
      .map((el) => `${el.tagName.toLowerCase()}: ${(el as HTMLElement).innerText.slice(0, 60)}`),
  );

/**
 * When the page scrolls sideways, what reaches past the right edge outside any box that
 * scrolls or clips; else nothing.
 */
const sideways = (page: Page) =>
  page.evaluate(() => {
    if (document.documentElement.scrollWidth <= window.innerWidth) return [];
    const contained = (el: Element) => {
      for (let box = el.parentElement; box && box !== document.body; box = box.parentElement) {
        if (getComputedStyle(box).overflowX !== "visible") return true;
      }
      return false;
    };
    return [...document.body.querySelectorAll("*")]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && !contained(el))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${el.className}: ${(el as HTMLElement).innerText?.slice(0, 60)}`,
      );
  });

async function openPage(browser: Browser, options: { width: number; dark?: boolean }) {
  // Reduced motion shows every reveal at once, so a full-page screenshot has no blank cards.
  const page = await browser.newPage({
    viewport: { width: options.width, height: 800 },
    reducedMotion: "reduce",
  });
  if (options.dark) await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  return page;
}

for (const locale of PREFIXED_LOCALES) {
  test(`${locale}: every page is in ${locale}, fits 360px and leaks no English`, async ({
    browser,
  }) => {
    const { leaks, held } = wording(locale);
    const page = await openPage(browser, { width: 360 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const path of PAGES) {
      const url = `/${locale}${path}`;
      await page.goto(url, { waitUntil: "networkidle" });
      expect(errors, url).toEqual([]);
      await expect(page.locator("html"), url).toHaveAttribute("lang", locale);
      expect(await sideways(page), `${url} scrolls sideways`).toEqual([]);
      expect(await clipped(page), `${url} clips text`).toEqual([]);
      const text = held.reduce(
        (rest, value) => rest.replaceAll(value, " "),
        await page.locator("body").innerText(),
      );
      expect(
        leaks.filter((value) => text.includes(value)),
        `${url} shows English`,
      ).toEqual([]);
    }
    await page.close();
  });

  test(`${locale}: pages declare their language, canonical and every alternate`, async ({
    request,
  }) => {
    for (const path of ["/", "/screener/", "/glossary/"]) {
      const html = await (await request.get(`/${locale}${path}`)).text();
      expect(html).toMatch(new RegExp(`<html lang="${locale}"`));
      expect(html).toContain(`<link rel="canonical" href="${SITE_URL}/${locale}${path}"/>`);
      for (const code of LOCALES) {
        const href = code === "en" ? `${SITE_URL}${path}` : `${SITE_URL}/${code}${path}`;
        expect(html).toContain(`<link rel="alternate" hrefLang="${code}" href="${href}"/>`);
      }
      expect(html).toContain(
        `<link rel="alternate" hrefLang="x-default" href="${SITE_URL}${path}"/>`,
      );
    }
  });
}

test("a language shows its disclaimers only once a native speaker has reviewed them", async ({
  page,
}) => {
  for (const locale of PREFIXED_LOCALES) {
    const t = CATALOGUES[locale];
    await page.goto(`/${locale}/`);
    const footer = page.locator("footer");
    await expect(footer.getByRole("link", { name: t.footer.compare })).toBeVisible();
    const shown = LANGUAGES[locale].reviewed ? t.common.disclaimer : en.common.disclaimer;
    await expect(footer.getByText(shown, { exact: true }), locale).toBeVisible();
  }
});

test("the sitemap lists every language's copy of a page with its alternates", async ({
  request,
}) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const code of PREFIXED_LOCALES) {
    expect(sitemap).toContain(`<loc>${SITE_URL}/${code}/screener/</loc>`);
  }
  expect(sitemap).toContain(`hreflang="ta" href="${SITE_URL}/ta/glossary/"`);
  expect(sitemap).not.toContain(`/hi/fund/`);
});

test("a fund page has one URL: no language copies, and no alternates to point at them", async ({
  request,
}) => {
  const { code } = publishedFund();
  const html = await (await request.get(`/fund/${code}/`)).text();
  expect(html).toContain(`<link rel="canonical" href="${SITE_URL}/fund/${code}/"/>`);
  expect(html).not.toContain(`hrefLang=`);
  expect((await request.get(`/hi/fund/${code}/`)).status()).toBe(404);
});

test("the switcher keeps the page, its query and hash, from the keyboard", async ({ page }) => {
  await page.goto("/glossary/?q=sharpe#metric-sharpe_3y");
  const button = page.getByRole("button", { name: en.language.label });
  await button.focus();
  await page.keyboard.press("Enter");
  const tamil = page.getByRole("link", { name: LANGUAGES.ta.name });
  await expect(tamil).toBeVisible();
  // Tab walks the list in order, so reaching Tamil proves every item is focusable.
  for (let i = 0; i <= LOCALES.indexOf("ta"); i++) await page.keyboard.press("Tab");
  await expect(tamil).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/ta\/glossary\/\?q=sharpe#metric-sharpe_3y$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ta");

  // Escape closes the list and gives focus back to the button.
  const taLabel = ta.language.label;
  const again = page.getByRole("button", { name: taLabel });
  await again.click();
  await expect(page.getByRole("link", { name: LANGUAGES.en.name })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: LANGUAGES.en.name })).toBeHidden();
  await expect(again).toBeFocused();

  await again.click();
  await page.getByRole("link", { name: LANGUAGES.en.name }).click();
  await expect(page).toHaveURL(/\/glossary\/\?q=sharpe#metric-sharpe_3y$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

/** The navbar menu's Screener link, in the language of `t`, with the menu opened. */
async function screenerLink(page: Page, t: Messages) {
  const menu = page.getByRole("banner").getByRole("button", { name: t.nav.menu });
  if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
  return page
    .getByRole("navigation", { name: t.nav.label })
    .getByRole("link", { name: t.nav.screener, exact: true });
}

test("a fund page switches language in place and keeps it across a reload", async ({ page }) => {
  const { code } = publishedFund();
  await page.goto(`/fund/${code}/`);
  await page.getByRole("button", { name: en.language.label }).click();
  await page.getByRole("button", { name: LANGUAGES.bn.name }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  await expect(page).toHaveURL(new RegExp(`/fund/${code}/$`));
  await expect(await screenerLink(page, bn)).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  await expect(await screenerLink(page, bn)).toBeVisible();
  await expect(page.locator("body")).toBeVisible();

  // A link out of the fund page leads to that language's copy of the next page.
  await (await screenerLink(page, bn)).click();
  await expect(page).toHaveURL(/\/bn\/screener\//);
});

test("a fund page opens in the browser's language when no choice is stored", async ({
  browser,
}) => {
  const { code } = publishedFund();
  const context = await browser.newContext({ locale: "hi-IN" });
  const page = await context.newPage();
  await page.goto(`/fund/${code}/`);
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(await screenerLink(page, hi)).toBeVisible();
  await context.close();
});

for (const locale of PREFIXED_LOCALES) {
  test(`${locale}: screenshots of the home and a fund page, phone and desktop, both themes`, async ({
    browser,
  }) => {
    const { code } = publishedFund();
    for (const width of [360, 1366]) {
      for (const dark of [false, true]) {
        const page = await openPage(browser, { width, dark });
        await page.addInitScript((l) => localStorage.setItem("mf-lang", l), locale);
        const name = `${locale}-${width === 360 ? "phone" : "desktop"}-${dark ? "dark" : "light"}`;
        await page.goto(`/${locale}/`, { waitUntil: "networkidle" });
        await page.screenshot({ path: `${ARTIFACTS}/${name}-home.png`, fullPage: true });
        await page.goto(`/fund/${code}/`, { waitUntil: "networkidle" });
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        expect(await sideways(page), `fund page in ${locale} at ${width}px`).toEqual([]);
        expect(await clipped(page), `fund page in ${locale} at ${width}px clips text`).toEqual([]);
        // Recharts draws each line in over 1.5 s; the evidence should show it whole.
        await page.waitForTimeout(1600);
        await page.screenshot({ path: `${ARTIFACTS}/${name}-fund.png`, fullPage: true });
        await page.close();
      }
    }
  });
}
