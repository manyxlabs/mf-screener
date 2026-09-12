/**
 * The twelve ideas a beginner needs before any column on this site means anything.
 *
 * These are the only hand-written entries in the glossary; everything else is
 * generated from the metric catalogue the API already serves. Each one ends at a
 * `/methodology` anchor, which stays the canonical statement of how a number is
 * actually computed. Keep them under about 120 words, and keep them descriptive -
 * nothing here tells the reader what to buy.
 */
export type Concept = {
  slug: string;
  term: string;
  body: string;
  /** Anchor on /methodology that proves or expands the claim. */
  methodologyAnchor?: string;
};

export const CONCEPTS: Concept[] = [
  {
    slug: "past-return",
    term: "Why every number here is history",
    body: "Every figure on this site describes what already happened. A fund that returned 18% a year for five years is a fund that returned 18% a year for five years; it is not a fund that will. Returns come from markets, and the market conditions that produced a past number are not repeatable to order. Use these numbers to understand how a fund has behaved - how it fell, how it recovered, how consistent it was, what it cost - rather than to forecast. Nothing here is advice, and nothing here is a prediction.",
    methodologyAnchor: "limitations",
  },
  {
    slug: "peer-group",
    term: "Peer group, and why it is your sub-category",
    body: "A small-cap fund and a liquid fund are not comparable, so every relative number here compares a fund only with funds in its own SEBI sub-category - Flexi Cap with Flexi Cap, Small Cap with Small Cap. That group is the fund's peers. When you see 'similar funds' on this site, that is what it means. The peer average also leaves the fund itself out of the calculation, so a large fund is not partly measured against itself. If a sub-category has too few funds to make a fair average, the comparison is left blank rather than computed on a handful.",
    methodologyAnchor: "peer-universe",
  },
  {
    slug: "rolling-vs-trailing",
    term: "Rolling returns, and why one 5-year number misleads",
    body: "A trailing 5-year return measures exactly one window: today back to five years ago. Move the start date a few months and the answer can change enormously, because it depends on whether you happened to begin at a market low or a high. A rolling return computes every possible 5-year window in the fund's history and shows the spread - typical, worst, best, and how often the window ended in profit. The worst window is usually the most informative number on the page: it is what an unlucky investor actually got. One trailing number hides all of that.",
    methodologyAnchor: "rolling",
  },
  {
    slug: "drawdown",
    term: "Drawdown: the worst fall",
    body: "A drawdown is the drop from a previous high point to the lowest point that followed, before a new high was reached. Maximum drawdown is the worst such fall on record. It matters more than volatility for most people, because it is the number that describes the moment you would have been most tempted to sell. Recovery time matters just as much: a 30% fall that took four years to make back is a very different experience from one recovered in eight months. This site computes drawdown on daily prices, because a month-end sample steps straight over the bottom.",
    methodologyAnchor: "drawdown",
  },
  {
    slug: "volatility",
    term: "Volatility: how bumpy the ride was",
    body: "Volatility measures how much a fund's monthly returns bounced around their own average. High volatility means large swings in both directions; it is not the same thing as risk of loss, though the two often travel together. It is quoted as an annual percentage. On its own it says nothing about whether a fund made money - a fund can be volatile and excellent, or steady and poor. It is most useful next to return: two funds with the same return and different volatility gave their investors very different experiences.",
    methodologyAnchor: "risk",
  },
  {
    slug: "expense-ratio",
    term: "Expense ratio, and Direct versus Regular",
    body: "The expense ratio is the annual fee the fund house charges, as a percentage of your money. It is already deducted from the NAV, so every return on this site is after that fee - never subtract it again. A Direct plan is the same portfolio with no distributor commission; a Regular plan pays a commission out of your returns, typically 0.5-1% a year, which compounds into a large difference over a decade. They are separate scheme codes with separate NAVs. This site defaults to Direct plans for exactly that reason.",
    methodologyAnchor: "peer-universe",
  },
  {
    slug: "index-vs-active",
    term: "Index funds versus active funds",
    body: "An index fund holds whatever an index holds, in the same proportions, and charges very little because no one is choosing. An active fund pays a manager to pick, and charges more for it. Neither is automatically better. The question a screener can help with is narrower and answerable: did this particular active fund actually beat its index, by enough to cover its extra cost, and did it do so consistently rather than once? Several columns here exist to answer that - excess versus the index, how reliably it beat it, and how much of its result the index alone explains.",
    methodologyAnchor: "benchmarks",
  },
  {
    slug: "benchmark",
    term: "Benchmark: the index a fund is measured against",
    body: "A benchmark is the index that represents what a fund is trying to do - Nifty 50 for a large-cap fund, Nifty Midcap 150 for a mid-cap one. Beating peers and beating the index are different achievements, and this site reports them separately. Where no suitable index series has been loaded for a fund's category, the index-relative columns are left blank with a stated reason rather than computed against something that does not fit. Some series here are built from an index fund's own NAV, which is net of that fund's costs, so it slightly understates the real index.",
    methodologyAnchor: "benchmarks",
  },
  {
    slug: "survivorship",
    term: "Survivorship: the funds that are not in the average",
    body: "Funds that performed badly often get merged into other funds or closed, and then they vanish from the list of funds you can screen today. Any average computed over surviving funds is therefore flattering, because the failures have been removed from it. This is not a small effect. This site measures it rather than only warning about it: category averages are computed twice, once over active funds and once including the ones that closed, and the gap between them is shown in percentage points wherever a category average appears.",
    methodologyAnchor: "survivorship",
  },
  {
    slug: "blank-values",
    term: "Why a number is blank",
    body: "A dash on this site never means zero and never means an error. It means the number could not be computed honestly, and clicking it tells you exactly why: too little history, too few comparable funds, no index loaded for that category, or a denominator that would make the ratio meaningless. The alternative - filling the gap with a category average or a zero - would make a fund with missing data look like a fund with ordinary data, which is worse than an obvious blank. Every reason has a name, and every name is explained where it appears.",
    methodologyAnchor: "data-quality",
  },
  {
    slug: "p-value",
    term: "What a p-value is doing on a fund screener",
    body: "When a fund beats its index, that can be skill or it can be luck. The p-value estimates how easily pure luck could have produced a result that good. A low p-value means luck is a poor explanation. The catch is scale: screen tens of thousands of funds and roughly 5% of them will clear the usual threshold by chance alone, with no skill whatsoever - which is over a thousand funds here. So a single impressive p-value found by screening is much weaker evidence than the same p-value found for a fund you were already examining. The methodology page states the expected false-positive count.",
    methodologyAnchor: "alpha-significance",
  },
  {
    slug: "sip-vs-lumpsum",
    term: "SIP versus lump sum",
    body: "Most people invest monthly rather than all at once, and the two produce genuinely different returns from the same fund. A trailing return assumes you put everything in on day one and took it all out at the end. A SIP return assumes a fixed amount every month, so money invested recently has had little time to compound while money from years ago has had a lot. When markets rose steeply early in the period, the lump-sum figure will look far better than anything a monthly investor actually received. Both are shown here, labelled separately.",
    methodologyAnchor: "sip-xirr",
  },
];
