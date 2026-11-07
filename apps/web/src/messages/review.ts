/**
 * Wording that must not reach readers in a language until a native speaker has checked
 * it: the finance disclaimers, risk wording, and the methodology text that explains what
 * a number means or how it is computed. Until a language is marked `reviewed` in
 * lib/i18n/locales.ts, its pages show the English for these, which is the version that
 * prevails anyway. `scripts/i18n-data-keys.mts --review <code>` prints the review sheet.
 */
import type { Messages } from "./en";

type Leaf = string | ((...args: never[]) => unknown) | readonly unknown[];

/** "a", "a.b", ...: every object and value in the catalogue, so a typo fails the type check. */
type Path<T> = {
  [K in keyof T & string]: T[K] extends Leaf ? K : K | `${K}.${Path<T[K]>}`;
}[keyof T & string];

// A sentence split around a link or code is listed whole, so it never mixes languages.
export const REVIEW_PATHS = [
  "meta.description",
  "common.disclaimer",
  "footer.attribution",
  "filters.universeHint",
  "filters.onePerFundWarning",
  "filters.attributesHint",
  "filters.styleBoxHint",
  "screener.metaDescription",
  "screener.survivorship",
  "compare.derived",
  "home.metaDescription",
  "home.readFirst",
  "categories.metaDescription",
  "category.metaDescription",
  "category.rollingBefore",
  "category.rollingLink",
  "category.rollingAfter",
  "compareView.metaDescription",
  "basket.metaDescription",
  "basket.notOverlapBody",
  "basket.benefitHint",
  "basket.correlationHint",
  "portfolio.notAdvice",
  "portfolio.xirrHint",
  "portfolio.costHeldHint",
  "portfolio.yearlyCostHint",
  "portfolio.regularVsDirectHint",
  "portfolio.directPlansHint",
  "portfolio.directNote",
  "portfolio.styleNote",
  "capitalGains.metaDescription",
  "capitalGains.disclaimerLead",
  "capitalGains.disclaimer",
  "capitalGains.sources.rules",
  "capitalGains.slab.hint",
  "capitalGains.fund.fromCategory",
  "capitalGains.fund.unsettled",
  "capitalGains.fund.grandfathers",
  "capitalGains.fund.listedHint",
  "capitalGains.incompleteHint",
  "capitalGains.notCovered",
  "capitalGains.lots.subtitle",
  "capitalGains.open.ifSoldHint",
  "glossary.concepts",
  "methodology.introBefore",
  "methodology.introLink",
  "methodology.introAfter",
  "methodology.riskFree",
  "methodology.formulasNote",
  "methodology.minimumsNote",
  "methodology.reasonsIntro",
  "methodology.survivorshipSides",
  "methodology.survivorshipGap",
  "methodology.survivorshipLimitation",
  "fund.metaDescription",
  "fund.rollingSummary",
  "fund.notForecast",
  "fund.categoryChange",
  "fund.currencyWithheld",
  "fund.staleBenchmark",
  "fund.stats.aumTooltip",
  "fund.returns.subtitle",
  "fund.returns.note",
  "fund.rolling.subtitle",
  "fund.risk.subtitle",
  "fund.capture.upHint",
  "fund.capture.downHint",
  "fund.capture.basis",
  "fund.cost.subtitle",
  "fund.cost.cheaper",
  "fund.cost.dearer",
  "fund.exposure.subtitle",
  "fund.exposure.explains",
  "fund.exposure.basisMismatch",
  "fund.drift.subtitle",
  "fund.peers.subtitle",
  "fund.attributes.subtitle",
  "fund.charts.rollingSubtitle",
] as const satisfies readonly Path<Omit<Messages, "data">>[];

/**
 * Pipeline text that explains rather than names: definitions, caveats, missing-value
 * reasons, methodology prose and disclaimers. A label such as "Ahead of / behind similar
 * funds ({0}Y)" or a value such as "monthly" names a figure without explaining it, so it
 * ships unreviewed. Methodology fragments ("the {0}/{1}/{2}-year readings blended on ...")
 * carry no full stop, so length and a lowercase start mark them instead.
 */
export function dataNeedsReview(english: string) {
  const words = english.match(/[^\W\d_]+/g)?.length ?? 0;
  const label = words <= 11 && (/^[A-Z]/.test(english) || words <= 4);
  // A question names a screen, as a heading does, so only a statement counts as prose.
  return /[.:;!](\s|$)/.test(english) || !label;
}
