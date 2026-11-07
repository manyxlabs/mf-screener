/**
 * The English catalogue, and the shape every other language must match: a key missing
 * from or added to another catalogue fails the type check. Functions take the values a
 * sentence needs, already formatted, so each language orders and inflects them itself.
 */

import type { PeerUniverse } from "@mf/shared";

const plural = (n: number, one: string, other: string) => (n === 1 ? one : other);

const en = {
  meta: {
    title: "Indian Mutual Fund Screener",
    description:
      "Screener for Indian mutual funds: trailing and rolling returns, peer-relative and risk-adjusted metrics. Research only, not investment advice.",
    ogImageAlt: "MF Screener home page",
  },
  common: {
    home: "Home",
    breadcrumb: "Breadcrumb",
    done: "Done",
    loading: "Loading...",
    disclaimer:
      "Research and analytics only. Not investment advice. Past returns do not guarantee future returns.",
  },
  units: { crore: "Cr", year: "yr", month: "mo", day: "d", pp: "pp", yes: "Yes", no: "No" },
  language: { label: "Language" },
  theme: { toLight: "Switch to light theme", toDark: "Switch to dark theme" },
  nav: {
    label: "Main",
    screener: "Screener",
    compare: "Compare",
    basket: "Basket",
    checkup: "Checkup",
    capitalGains: "Capital gains",
    glossary: "Glossary",
    methodology: "Methodology",
    menu: "Menu",
  },
  footer: {
    blurb:
      "Every Indian mutual fund, measured from its own NAV history against funds of the same kind. Free, open source and rebuilt every night.",
    tools: "Tools",
    learn: "Learn",
    project: "Project",
    categories: "Fund categories",
    compare: "Compare funds",
    basket: "Basket analysis",
    checkup: "Portfolio checkup",
    capitalGains: "Capital gains tax",
    overlap: "Portfolio overlap",
    benchmarks: "Benchmark coverage",
    dataStatus: "Data status",
    source: "Source on GitHub",
    issue: "Report an issue",
    contribute: "How to contribute",
    asOf: (nav: string, metrics: string) => `Latest NAV ${nav} · metrics as of ${metrics}.`,
    attribution:
      "NAV data originates from AMFI public records, delivered through the TigZig MF NAV API. Not affiliated with or endorsed by AMFI; verify anything that matters against AMFI directly.",
  },
  search: {
    placeholder: "Search funds…",
    placeholderLarge: "Search any fund by name or AMC…",
    label: "Search funds",
    searching: "Searching…",
    noMatch: (query: string) => `No schemes match “${query}”.`,
    unknownAmc: "Unknown AMC",
  },
  table: {
    region: "Results table, scrolls sideways",
    sortBy: (column: string) => `Sort by ${column}`,
    sortHint: "Sort. Hold shift to add a secondary sort.",
    select: (fund: string) => `Select ${fund}`,
    empty: "No funds match these filters. Loosen a range, or widen the plan/option universe.",
    columns: {
      scheme_code: "Code",
      scheme_name: "Fund",
      amc: "Fund house",
      clean_category: "Category",
      clean_sub_category: "Fund type",
      clean_plan: "Plan",
      clean_option: "Option",
      benchmark_id: "Measured against",
      is_active: "Active",
      first_nav_date: "First NAV",
      last_nav_date: "Last NAV",
      latest_nav_date: "NAV date",
      aum_quarter: "AUM quarter",
      cap_band: "Company size focus",
      style: "Investing style",
      riskometer: "SEBI risk label",
      data_quality_flags: "Data warnings",
    },
  },
  columnPicker: {
    label: "Columns",
    title: (n: number) => `Columns (${n})`,
    starter: "Starter",
    standard: "Standard",
    everything: "Everything",
    search: "Search columns",
    other: "Other",
    whatItMeans: (column: string) => `What ${column} means`,
  },
  filters: {
    title: "Filters",
    clear: "Clear",
    universe: "Universe",
    universeHint:
      "Direct and Growth only by default. Direct and Regular plans of one fund have different NAVs, and IDCW options pay out of NAV, so mixing them corrupts every comparison.",
    lastTicked: "At least one plan and one option stay ticked.",
    planOption: {
      Direct: "Direct",
      Regular: "Regular",
      Unknown: "Unknown",
      Growth: "Growth",
      "IDCW Payout": "IDCW Payout",
      "IDCW Reinvestment": "IDCW Reinvestment",
      Bonus: "Bonus",
      Other: "Other",
    },
    onePerFund: "One row per fund",
    onePerFundWarning:
      "Direct and Regular, Growth and IDCW are separate scheme codes for one fund. Showing them all inflates every count and lets one fund occupy several places in a ranking.",
    attributes: "Shortlist attributes",
    attributesHint:
      "Riskometer, exit load, lock-in, minimums, SID benchmark and fund manager are third-party facts, not computed from NAV. A fund the source has not published these for cannot satisfy either filter below - it is left out, not assumed to qualify.",
    noExitLoad: "No exit load",
    tenure: "Manager tenure at least (years)",
    tenurePlaceholder: "e.g. 3",
    tenureLabel: "Manager tenure minimum, in years",
    styleBox: "Style box",
    styleBoxHint:
      "The mandate each scheme declares, read from its SEBI sub-category and its own name. A holdings-based style box needs the price-to-book of the portfolio, which AMFI does not publish, so this is what the fund says it does, not what it currently owns.",
    capBand: "Cap band",
    style: "Style",
    subCategory: "Sub-category",
    amc: "AMC",
    groups: {
      trailing: "Trailing returns",
      rolling: "Rolling returns",
      subCategory: "Versus sub-category",
      benchmark: "Versus benchmark",
      risk: "Risk",
      basics: "Fund basics",
    },
    inCrore: "in crore",
    plainNumber: "a plain number",
    min: "min",
    max: "max",
    minPercent: (field: string) => `${field} minimum, in percent`,
    maxPercent: (field: string) => `${field} maximum, in percent`,
    minOf: (field: string) => `${field} minimum`,
    maxOf: (field: string) => `${field} maximum`,
    searchIn: (list: string) => `Search ${list.toLowerCase()}`,
    noMatches: "No matches.",
  },
  metric: {
    higherBetter: "Better: higher",
    lowerBetter: "Better: lower",
    neitherBetter: "Neither direction is better",
    frequency: (value: string) => `Frequency: ${value}`,
    period: (value: string) => `Period: ${value}`,
    caveat: (value: string) => `Caveat: ${value}`,
    fullExplanation: "Full explanation",
    explainMissing: "Explain why this value is missing",
    notAvailable: "Not available",
    vsPeers: { flat: "level with peers", above: "above peers", below: "below peers" },
  },
  charts: {
    noRolling: "Not enough NAV history to draw a rolling series at this horizon.",
    windowEnding: (date: string) => `Window ending ${date}`,
    fund: "Fund",
    subCategoryAverage: "Sub-category average",
    noNav: "No NAV history stored.",
    noStyle: "Not enough fitted rolling windows to chart a style mix over time.",
  },
  picker: {
    full: (max: number) => `${max} funds chosen: remove one to add another`,
    placeholder: "Add a fund: name, AMC or scheme code",
    count: (chosen: number, max: number) => `${chosen} of ${max} chosen`,
  },
  screener: {
    metaTitle: "Mutual fund screener: filter by rolling returns, risk and cost",
    metaDescription:
      "Filter every active Indian mutual fund on trailing and rolling returns, worst falls, peer-relative performance, risk-adjusted ratios and expense ratio, then save the screen or export it as CSV. Not investment advice.",
    title: "Mutual fund screener",
    loadingScreener: "Loading screener...",
    matches: (n: number, shown: string) => `${shown} ${plural(n, "fund matches", "funds match")}`,
    sortedBy: (description: string) => `sorted by ${description}`,
    sort: { lowestFirst: "lowest first", highestFirst: "highest first", then: "then" },
    clearRules: (shown: string, universe: string, rules: number) =>
      `${shown} of the ${universe} funds in this universe clear the ${plural(rules, "numeric rule", `${rules} numeric rules`)}; the rest fall short of one or have no value for it.`,
    search: "Search fund or AMC",
    preset: "Preset screen",
    applyPreset: "Apply a preset...",
    advanced: "Show advanced columns",
    advancedHint: "Switch to the fuller standard column set",
    columns: (n: number, starter: boolean) => `Columns (${n}${starter ? " · starter" : ""})`,
    export: "Export CSV",
    exporting: "Exporting...",
    compareSelected: (n: number) => `Compare ${n} selected`,
    selectToCompare: "Select up to five funds to compare.",
    nameScreen: "Name this screen",
    save: "Save this screen",
    deleteSaved: (name: string) => `Delete saved screen ${name}`,
    survivorship:
      "Category averages above are active-only and do not include funds that closed or merged, which flatters them (survivorship bias). The methodology page explains how that gap is measured.",
    errorHint: "If this is a filter error, clear the offending range in the filter drawer.",
    page: (page: number, pages: number) => `Page ${page} of ${pages}`,
    rowsPerPage: "Rows per page",
    rows: (n: number) => `${n} rows`,
    previous: "Previous",
    next: "Next",
    methodology: "Methodology applied to this screen",
    metricsAsOf: (date: string, version: string) => `Metrics as of ${date} (v${version})`,
    peerUniverse: (u: PeerUniverse) =>
      `Peer universe: ${u.plan_scope} plans, ${u.option_scope} option, ${u.active_only ? "active only" : "all schemes"}, ${u.aggregation} of at least ${u.min_peers} peers, ${u.exclude_self ? "excluding" : "including"} the fund itself`,
    riskFree: (rate: string) => `Risk-free rate: ${rate} annual`,
  },
  compare: {
    wholeHistory: "whole stored history",
    derived: {
      worst_fall: {
        label: "Worst fall",
        definition: "Deepest peak-to-trough fall in daily NAV over the whole stored history.",
        caveat:
          "Carried as a negative number, so a smaller fall is the higher value. It covers the fund's own history only, which for a young fund may contain no correction at all.",
      },
      worst_fall_recovery_days: {
        label: "Time to recover from it",
        definition: "Calendar days from the pre-fall high to the day that high was regained.",
        caveat:
          "Blank when the fund has not yet regained that high, which is worse than any number here, not better.",
      },
      up_capture: {
        label: "Up capture",
        definition:
          "Compounded fund return over the months its sub-category rose, divided by the sub-category's own return over those months.",
        caveat: "Measured against the equal-weighted peer return, not a benchmark index.",
      },
      down_capture: {
        label: "Down capture",
        definition:
          "The same ratio over the months the sub-category fell. Below 1 means the fund fell less than its peers.",
        caveat: "A fund can score well here simply by holding cash, which costs it on the up side.",
      },
      calendar_years_beaten_pct: {
        label: "Calendar years beating peers",
        definition:
          "Share of complete and partial calendar years in which the fund beat its sub-category.",
        caveat: "A young fund is judged on very few years, so read it beside the fund's age.",
      },
    },
  },
  home: {
    metaTitle: "Indian Mutual Fund Screener: rolling returns, peers and risk",
    metaDescription:
      "Free research tool for Indian mutual funds: rolling returns, peer comparison, risk metrics, fund comparison, a capital gains calculator and CAS portfolio analysis. Not investment advice.",
    // Keyed by AMFI's sub-category, which stays as AMFI names it; the value is our chip label.
    quickLinks: {
      "Large Cap Fund": "Large Cap",
      "Flexi Cap Fund": "Flexi Cap",
      "Mid Cap Fund": "Mid Cap",
      "Small Cap Fund": "Small Cap",
      "Multi Cap Fund": "Multi Cap",
      "Value Fund": "Value",
      "Index Funds": "Index Funds",
    },
    overseas: "S&P 500 / overseas",
    allCategories: "All categories",
    activeFunds: (shown: string) => `${shown} active funds`,
    navTo: (date: string) => `NAV to ${date}`,
    rebuiltDaily: "Rebuilt daily",
    title: "Which Indian mutual funds have actually done what they claim?",
    lede: "Every figure is computed here from AMFI’s published NAV history, against funds of the same kind, and every blank says why. It is a research tool: it will not tell you what to buy.",
    presetsHeading: "Start from a question",
    presetsLede:
      "Editable starting points, not shortlists. Each opens in the screener with its filters showing, so you can change them.",
    openPreset: "Open this screen",
    ownScreen: {
      title: "Or build your own screen",
      body: "Filter every active fund on returns, consistency, worst falls, cost and peer standing, then save the screen or export it as CSV.",
      cta: "Open the screener",
    },
    toolsHeading: "Already have funds in mind?",
    tools: {
      compare: {
        title: "Compare funds",
        body: "Up to five funds side by side, with the best and worst value in every row marked.",
        cta: "Compare",
      },
      basket: {
        title: "Test a basket",
        body: "Give a few funds a weight each and see how they move together and what blending them does to risk and return.",
        cta: "Build a basket",
      },
      glossary: {
        title: "Learn the terms",
        body: "Every number on this site explained in plain words: what it measures, which way is better and where it misleads.",
        cta: "Open the glossary",
      },
    },
    readFirstHeading: "Three things to know before you read any number",
    readFirst: {
      pastReturn: {
        heading: "Every number here is the past",
        body: "Returns describe what already happened, under market conditions that will not repeat to order. Nothing on this site is a forecast, a rating or a recommendation.",
      },
      peerGroup: {
        heading: "Funds are compared with their own kind",
        body: "A small-cap fund is measured against small-cap funds, never against the whole market. Funds that closed are missing from that average, which flatters it.",
      },
      blankValues: {
        heading: "A dash is an answer, not a gap",
        body: "Where a number could not be computed honestly it is left blank, and clicking the blank says exactly why. Nothing is filled in with an average.",
      },
    },
    readMore: "Read more",
  },
  notFound: {
    title: "Page not found",
    heading: "This page does not exist",
    body: "The address may be mistyped, or the fund may no longer be published: only active schemes have a page. Search for a fund above, or start from one of these.",
  },
  error: {
    heading: "Could not load this page",
    body: "The page’s data could not be read. Check your connection and try again.",
    retry: "Try again",
  },
  categories: {
    metaTitle: "Mutual fund categories: rolling returns by sub-category",
    metaDescription:
      "Every Indian mutual fund sub-category with enough funds to compare, from Large Cap and Mid Cap to liquid and gilt funds, each with trailing and rolling returns for all its funds. Not investment advice.",
    lede: "Every sub-category AMFI uses with enough funds to compare, named as AMFI names them. Each page lists all of its active Direct Growth funds A to Z with their trailing and rolling returns, worst stretches and expense ratios. A fund is only ever measured against funds of its own kind.",
    other: "Other",
  },
  category: {
    title: (subCategory: string) => `${subCategory}: rolling returns of every fund`,
    metaDescription: (shown: string, subCategory: string) =>
      `Trailing and rolling 3 and 5-year returns, worst stretches and expense ratios for the ${shown} active Direct Growth funds in AMFI's ${subCategory} sub-category, computed from AMFI NAV history. Listed A to Z, not ranked. Not investment advice.`,
    lede: (n: number, shown: string, subCategory: string, category: string | null, asOf: string) =>
      `The ${shown} active Direct Growth ${plural(n, "fund", "funds")} in AMFI's ${subCategory} sub-category${category ? ` (${category})` : ""}, one row per fund. Every figure is computed from AMFI's published NAV history, with metrics as of ${asOf}.`,
    listed: "Listed A to Z, not ranked. ",
    inScreener: "Sort and filter this sub-category in the screener",
    or: ", or ",
    compare: "compare up to five funds side by side",
    end: ".",
    rollingBefore:
      "A rolling return is the per-year return over every overlapping 3 or 5-year stretch of a fund’s history: the typical figure is the median of those stretches and the worst is the lowest, which is what an unlucky investor actually got. ",
    rollingLink: "Why rolling returns say more than one trailing return",
    rollingAfter:
      ". A dash means the figure could not be computed, usually because the fund is too young; the fund’s own page says why.",
  },
  benchmarks: {
    metaDescription:
      "Which index each Indian mutual fund is measured against, where each series came from, which are index-fund proxies and what the benchmark mapping does not cover.",
    title: "Benchmarks",
    lede: "Which index each fund is measured against, where that index came from, and what it does not cover. Alpha, beta, tracking error and the benchmark information ratio all come from the series listed here.",
    notComparable: (currency: string) => `not comparable with ${currency}`,
    foreignHeading: (n: number, shown: string, currency: string) =>
      n === 1
        ? `One loaded benchmark is not in ${currency}`
        : `${shown} loaded benchmarks are not in ${currency}`,
    foreignMapped: (n: number, shown: string) =>
      `${shown} ${plural(n, "scheme", "schemes")} mapped · no benchmark-relative metric is computed`,
    seriesLoaded: "Series loaded",
    schemesMapped: "Schemes mapped",
    of: (total: string) => `of ${total}`,
    schemesUnmapped: "Schemes unmapped",
    unmappedHint: 'benchmark metrics read "-"',
    loadedTitle: "Loaded series",
    loadedSubtitle: "Everything a benchmark-relative metric can currently be computed from.",
    columns: {
      benchmark: "Benchmark",
      currency: "Currency",
      coverage: "Coverage",
      months: "Months",
      schemes: "Schemes",
      source: "Source",
    },
    proxy: "index-fund proxy",
    none: 'No benchmark series loaded. Alpha, beta, tracking error and the benchmark information ratio read "-" for every fund until you import one with ',
    noneEnd: ".",
    warningsTitle: "Coverage warnings",
    warningsSubtitle: "What the numbers on this site do not cover.",
    rulesTitle: "Mapping rules",
    rulesSubtitle: (version: string) =>
      `benchmark_map.yaml v${version} - the first rule a scheme matches wins.`,
    ruleColumns: {
      matches: "Matches",
      benchmark: "Benchmark",
      fallbacks: "Fallbacks",
      note: "Note",
    },
    and: "AND",
    or: "OR",
    nameContains: (text: string) => `name: ${text}`,
    nameExcludes: (text: string) => `not: ${text}`,
    notLoaded: "(not loaded)",
    preferred: (currency: string) =>
      `A series in ${currency} is always preferred over a foreign-currency one, wherever it sits in the fallback order. `,
    edit: "Edit ",
    rerun: " and re-run ",
    toChange: " to change any of this.",
    unmappedTitle: "Unmapped sub-categories",
    unmappedSubtitle: "No rule matches these, so their benchmark-relative metrics are null.",
    methodBefore: "Method and formulas are on the ",
    methodLink: "methodology page",
    methodAfter: ". ",
  },
  dataStatus: {
    metaDescription:
      "What the screener has loaded from AMFI: funds and NAV rows, NAV coverage dates, when metrics were last rebuilt and the default screening universe.",
    lede: "What is loaded, how far it reaches, and when it was last rebuilt.",
    fundsLoaded: "Funds loaded",
    schemeCodes: (shown: string) => `${shown} scheme codes`,
    fundsTooltip:
      "Direct and Regular, Growth and IDCW are separate scheme codes for one economic fund. This counts the funds; the scheme code count is what AMFI publishes, and it is larger.",
    navRows: "Daily NAV rows",
    navCoverage: "NAV coverage",
    to: (date: string) => `to ${date}`,
    metricsAsOf: "Metrics as of",
    methodologyVersion: (version: string) => `methodology v${version}`,
    benchmarksLoaded: "Benchmarks loaded",
    seeCoverage: "see coverage below",
    importTri: "import a TRI CSV",
    universeTitle: "Default screening universe",
    universeSubtitle: "Change any of this in the screener's filter drawer.",
    planScope: (scope: string) => `Plan scope: ${scope}`,
    optionScope: (scope: string) => `Option scope: ${scope}`,
    activeOnly: (on: boolean) => `Active schemes only: ${on ? "yes" : "no"}`,
    peerAverage: (aggregation: string, leaveOneOut: boolean, minPeers: number) =>
      `Peer average: ${aggregation}, leave-one-out ${leaveOneOut ? "on" : "off"}, minimum ${minPeers} peers`,
    benchmarkTitle: "Benchmark coverage",
    benchmarkSubtitle:
      "Benchmark-relative metrics are only computed where a comparable series is loaded.",
    noBenchmarks:
      'No benchmark series loaded. Alpha, beta, tracking error and the benchmark information ratio will all read "-" until you import one with ',
    noBenchmarksEnd: ".",
    coverage: (series: string, mapped: string, total: string, unmapped: string) =>
      `${series} series loaded, covering ${mapped} of ${total} schemes. ${unmapped} have no benchmark mapped.`,
    foreign: (n: number, ids: string, currency: string) =>
      `${ids} ${plural(n, "is", "are")} not quoted in ${currency}. No benchmark-relative metric is computed against ${plural(n, "it", "them")}: the difference would include the exchange rate.`,
    benchmarksLink: "Benchmarks and mapping rules",
    runsTitle: "Last pipeline runs",
    runColumns: { step: "Step", status: "Status", rows: "Rows", finished: "Finished" },
    riskFree: (rate: string) =>
      `Risk-free rate in use: ${rate} annual by default, configurable with MF_RISK_FREE_ANNUAL. See the methodology page for the exact conversion.`,
  },
  compareView: {
    metaTitle: "Compare mutual funds side by side",
    metaDescription:
      "Compare up to five Indian mutual funds on trailing and rolling returns, returns against their sub-category, worst falls, risk ratios and cost, with the best and worst value in each row marked. Not investment advice.",
    title: "Compare funds",
    intro: (max: string) =>
      `Up to ${max} funds side by side. In each row the best value is marked ▲ and the worst ▼, judged by that metric's own better direction. Rows where neither end is better, such as beta, are left unmarked.`,
    loading: "Loading comparison...",
    search: "Search funds to compare",
    cost: "Cost",
    downside: "Downside and consistency",
    notComparable: "This is not an apples-to-apples comparison.",
    spansSubCategories: (n: string, list: string) =>
      `These funds span ${n} sub-categories (${list}).`,
    mixPlans: (list: string) =>
      `They mix plans (${list}), and the same portfolio has a different NAV in each.`,
    mixOptions: (list: string) =>
      `They mix options (${list}); an IDCW option pays out of NAV, so its return series is not comparable to a Growth one.`,
    emptyTitle: "Nothing to compare yet",
    emptyBody:
      "Add funds with the search above, or tick up to five rows in the screener and press Compare. Funds of the same type and plan compare most fairly.",
    emptyCta: "Find funds in the screener",
    metric: "Metric",
    remove: (fund: string) => `Remove ${fund}`,
    removeTitle: "Remove",
    best: "(best of those compared)",
    worst: "(worst of those compared)",
  },
  basket: {
    metaTitle: "Mutual fund basket analysis: correlation and blended risk",
    metaDescription:
      "Give a few Indian mutual funds a weight each and see how they move together: return correlation, and what blending them does to return, volatility and worst fall. Not investment advice.",
    loading: "Loading basket...",
    title: "Basket analysis",
    intro: (max: string) =>
      `Pick up to ${max} funds and a weight for each to see how they move together and what blending them does to risk and return.`,
    search: "Search funds to add to the basket",
    weights: "Weights",
    weightsHint: "Any positive numbers work: they are scaled to add up to 100% before scoring.",
    weightFor: (fund: string) => `Weight for ${fund}`,
    remove: (fund: string) => `Remove ${fund}`,
    removeTitle: "Remove",
    equalise: "Reset to equal weights",
    emptyTitle: "Your basket is empty",
    emptyBody:
      "Add two or more funds with the search above. Funds need about three years of shared history before a blend can be scored.",
    notOverlap: "Correlation of returns is not portfolio overlap.",
    notOverlapBody:
      "Two funds holding entirely different stocks can still move together every month, and two funds holding the same stocks in different weights can still show up here as only loosely correlated. This basket is built purely from NAV history - it says nothing about what either fund actually owns.",
    scoring: "Scoring basket...",
    shortHistory: "Not enough shared history",
    sharedMonths: (n: number, shown: string, required: string) =>
      `These funds only share ${shown} matched ${plural(n, "month", "months")} of history; ${required} are required.`,
    blended: "The blended basket",
    blendReturn: "Blend return per year",
    blendVolatility: "Blend volatility",
    blendSharpe: "Blend Sharpe",
    blendWorstFall: "Blend worst fall",
    benefit: "Diversification benefit",
    benefitHint:
      "The weighted average of each fund's own volatility, minus the blend's volatility. Zero means the funds moved in lockstep; positive means blending them actually reduced risk.",
    correlation: "Correlation of monthly returns",
    correlationHint: (n: number, shown: string) =>
      `Over ${shown} matched ${plural(n, "month", "months")} shared by every fund in the basket. 1 means they moved in lockstep.`,
    versus: "Blended basket vs each component",
    columns: {
      fund: "Fund",
      weight: "Weight",
      return: "Return per year",
      volatility: "Volatility",
      sharpe: "Sharpe",
      worstFall: "Worst fall",
      upCapture: "Up-capture of blend",
      downCapture: "Down-capture of blend",
    },
    blendRow: "Blended basket",
  },
  overlap: {
    metaTitle: "Mutual fund portfolio overlap",
    metaDescription:
      "How portfolio overlap between two mutual funds is measured, and why this site shows no overlap figure: no holdings data is published, so none is guessed.",
    title: "Portfolio overlap",
    intro:
      "How much of two funds’ money sits in the same instruments. Two funds you hold for diversification can turn out to be largely the same portfolio.",
    measure:
      "Overlap is the sum of the smaller weight in each shared holding, so two identical portfolios are 100% and two with nothing in common are 0%. Holdings are a month-old photograph: the fund can have traded since. This is a different measurement from the ",
    measureLink: "return correlation on the basket page",
    measureAfter: ", and two funds holding different stocks can still move together.",
    noHoldings: "No holdings are loaded",
    noHoldingsBody:
      "This site publishes no holdings data: AMFI publishes none, and the one free third-party source was unreachable on every probe. So no overlap figure is shown here, rather than a 0% that would read as two funds having nothing in common. Running the API yourself, you can import your own with ",
    noHoldingsRead: " and read overlap from ",
    noHoldingsAfter:
      " - the CSV contract is in the README, and nothing is written unless the whole file passes.",
  },
  portfolio: {
    metaTitle: "CAS portfolio analysis: holdings, XIRR, allocation and costs",
    metaDescription:
      "Read your CAMS/KFintech consolidated account statement in the browser: holdings at the latest NAV, XIRR, allocation and what expense ratios cost in rupees. Nothing is uploaded.",
    title: "Portfolio checkup",
    intro:
      "Open your consolidated account statement to see your mutual fund holdings at the latest NAV, the return your own cash flows earned, where the money sits and what expense ratios cost you in rupees each year.",
    errors: {
      wrongPassword:
        "That password did not open the statement. It is the one you chose when you requested the CAS.",
      needsPassword:
        "This statement is password protected. Enter the password you chose when you requested it.",
      not_pdf: "This file is not a readable PDF.",
      not_cas: "This PDF is not a CAMS/KFintech Consolidated Account Statement.",
      demat:
        "This is a depository (NSDL or CDSL) statement. Upload the CAMS/KFintech statement instead: it lists mutual fund folios with their transactions.",
      summary:
        "This is the summary statement, which has no transactions. Request the detailed one.",
      unreadable: (detail: string) => `The statement could not be read: ${detail}`,
    },
    yourStatement: "Your statement",
    choose: "Choose or drop your CAS PDF",
    chooseAnother: "Choose another file",
    chooseHint: "The detailed CAMS/KFintech statement",
    fileLabel: "CAS PDF",
    password: "Statement password",
    passwordPlaceholder: "The password you set when requesting it",
    reading: "Reading...",
    read: "Read statement",
    local: "Nothing leaves this browser tab.",
    private: "Private by construction.",
    privateBody:
      "The PDF is read by this page inside your browser. This site is static files with no server that could receive it, so nothing is uploaded, stored or logged, and closing the tab discards it.",
    howTo: "How to get your CAS",
    step1: {
      before: "Open the ",
      cams: "CAMS consolidated account statement page",
      choose: " and choose ",
      choice: "CAS - CAMS + KFintech",
      kfintech:
        ", which covers funds serviced by both registrars. KFintech offers the same statement on its ",
      kfintechLink: "investor site",
      after: ".",
    },
    step2: {
      before: "Pick statement type ",
      detailed: "Detailed",
      period: " (it includes the transaction listing), period ",
      specific: "Specific period",
      after:
        " from 01-Jan-1990 to today, and folio listing with zero-balance folios. A statement that starts later leaves out the cost of earlier purchases, so no return can be computed from it.",
    },
    step3: "Enter the email registered on your folios. PAN is optional.",
    step4:
      "Choose a password for the PDF. It arrives by email, usually within minutes; open it here with that password.",
    demat: "Depository statements from NSDL or CDSL are a different format and are not read here.",
    amfi: "AMFI explains the CAS",
    summary: (s: {
      investor: string | null;
      period: { from: string; to: string } | null;
      holdings: number;
      holdingsShown: string;
      redeemed: number;
      redeemedShown: string;
    }) =>
      `${s.investor ? `Statement for ${s.investor}` : "Statement"}${s.period ? `, ${s.period.from} to ${s.period.to}` : ""}. ${s.holdingsShown} ${plural(s.holdings, "holding", "holdings")}${s.redeemed ? `, plus ${s.redeemedShown} fully redeemed (counted in the return)` : ""}. Units are as of the statement, valued at the latest NAV in this site’s data.`,
    totals: "Portfolio totals",
    currentValue: "Current value",
    unvalued: (n: number, shown: string) =>
      `${shown} ${plural(n, "holding", "holdings")} without a value left out`,
    costHeld: "Cost of units held",
    costHeldHint:
      "What was paid for the units still held, matching sales against the oldest units first. Reinvested payouts count at their reinvested amount; stamp duty is left out.",
    gain: "Gain",
    xirr: "XIRR",
    xirrHint:
      "The annual rate that makes every purchase, redemption, payout and tax in the statement, plus today's value, net to zero. Funds since redeemed count too. It is your return on your own timing, not the funds' published returns.",
    yearlyCost: "Expense ratios per year",
    covered: (covered: string, total: string) => `${covered} of ${total} holdings`,
    yearlyCostHint:
      "Each fund's current total expense ratio applied to today's value. The fund takes this out of the NAV daily, so it is already inside every return shown here.",
    regularVsDirect: "Regular vs direct per year",
    compared: (n: number, shown: string) =>
      `${shown} regular-plan ${plural(n, "holding", "holdings")} compared`,
    regularVsDirectHint:
      "For holdings in a regular plan: the gap between its expense ratio and its direct plan's, applied to today's value.",
    holdings: "Holdings",
    holdingsHint: "Funds held in more than one folio are added together.",
    columns: {
      fund: "Fund",
      units: "Units",
      nav: "NAV",
      value: "Value",
      cost: "Cost",
      gain: "Gain",
      xirr: "XIRR",
      expenseRatio: "Expense ratio",
      costPerYear: "Cost per year",
    },
    byCategory: "By category",
    bySubCategory: "By sub-category",
    notAdvice:
      "These are figures from your statement and the published data, not advice. Expense ratios and NAVs are the latest this site has; a fund’s past return says nothing certain about its next one.",
    folio: (folios: string) => `Folio ${folios}`,
    statementValuation: "Statement valuation",
    statementValuationHint: (date: string) =>
      `This scheme is not in the site’s data, usually because it closed or merged into another, so it is valued at the statement’s own NAV of ${date}.`,
    noNav: "No NAV in the site's data or the statement.",
    directPlans: "Regular plans and their direct plans",
    directPlansHint:
      "The same fund and portfolio, sold without a distributor's commission inside the expense ratio.",
    expenseRatio: "Expense ratio",
    directPlan: "Direct plan",
    difference: "Difference",
    aYear: "a year",
    directNote:
      "The yearly figure is the gap between the two expense ratios applied to today’s value, so it moves with the value and the ratios. Moving between plans is a redemption and a new purchase, so any exit load and capital gains tax on the redemption apply.",
    notInData: "Not in the site's data",
    similarStyle: "Funds with a similar style",
    similarStyleHint: (share: string) =>
      `Pairs whose estimated style mixes share ${share} or more, as the sum of the smaller weight on each index.`,
    loadingStyle: "Loading style estimates...",
    fewStyles:
      "Fewer than two holdings have a style estimate, so there is nothing to compare. Debt, gold and international funds, and funds under two years old, have none.",
    noSimilar: (fitted: string, share: string) =>
      `No two of the ${fitted} funds with a style estimate share ${share} or more of it.`,
    and: " and ",
    styleNote:
      "Each fund’s mix of index returns is fitted from how its NAV moved, as on its fund page, not read from holdings: two funds can share a style and hold different stocks.",
    // Keyed by the codes lib/portfolio.ts returns.
    reasons: {
      opening:
        "The statement starts after the first purchase, so what the opening units cost is not in it. A statement from 01-Jan-1990 covers every transaction.",
      oversold: "More units left this holding than the statement shows coming in.",
      noFlows: "No cash flows in the statement.",
      underYear: "Invested for under a year, where an annual rate would overstate a short run.",
      noRate: "No single rate balances these cash flows.",
      noExpenseRatio: "This plan's expense ratio is not in the data.",
      noDirectRatio: "The direct plan's expense ratio is not in the data.",
      noDirectPlan: "No direct plan of this fund is in the data.",
      noValue: "Neither the site's data nor the statement gives a value for this holding.",
      notInData: "Not in the site's data.",
      incomplete: "A holding has no value, so the total is incomplete.",
    },
    reasonIn: (fund: string, reason: string) => `${fund}: ${reason}`,
  },
  capitalGains: {
    metaTitle: "Mutual fund capital gains calculator",
    metaDescription:
      "Estimate capital gains on Indian mutual fund units by financial year: FIFO lots, short and long-term gains under sections 111A, 112 and 112A, and the tax. An estimate, not tax advice.",
    title: "Capital gains calculator",
    intro:
      "Enter your mutual fund purchases and redemptions to see the capital gains in each financial year, matched first-in first-out and split the way the Income Tax Act treats them, with the tax worked out.",
    privacy:
      "What you enter stays in this browser and is never sent anywhere. Record a switch as a sale in the fund you left and a purchase in the fund you joined, on the switch date.",
    loading: "Loading calculator...",
    disclaimerLead: "An estimate, not tax advice.",
    disclaimer:
      "Check every figure against the Capital Gains Statement from CAMS or KFintech and with your tax adviser before you file. Surcharge, the section 87A rebate, the basic exemption limit, losses carried forward from earlier years and gains outside this calculator are all left out.",
    pickByHand: "Or search funds to add them by hand",
    emptyTitle: "No funds added yet",
    emptyHint:
      "Add a fund with the search above, then enter each purchase and redemption with its date, units and NAV or amount.",
    slab: {
      title: "Your slab rate",
      subtitle: "Optional. Used only for gains taxed at the slab rate.",
      label: "Slab rate",
      placeholder: "e.g. 30",
      hint: "Short-term gains on debt funds, and on other non-equity funds held too briefly, are added to your income and taxed at your slab rate. Without one, those gains are shown but their tax is not estimated.",
    },
    import: {
      title: "Fill it from your CAS statement",
      subtitle:
        "The detailed CAMS + KFintech statement, with transactions. Read in your browser; nothing is uploaded.",
      file: "Statement (PDF)",
      password: "Statement password",
      reading: "Reading...",
      add: "Add its funds",
      wrongPassword: "That password did not open the statement.",
      needsPassword:
        "This statement is password protected. Enter the password you chose when you requested it.",
      unreadable: "This file could not be read as a CAS statement.",
      added: (n: number, shown: string) =>
        `Added ${shown} ${plural(n, "fund", "funds")}. Check the tax type of each below.`,
      checkupBefore: "",
      checkupLink: "The portfolio checkup",
      checkupAfter: " reads the same statement.",
      leftOut: (shown: string) => `${shown} left out, with the reason`,
      notInData: (fund: string) => `${fund}: not in this site's data`,
      openingUnits: (fund: string) =>
        `${fund}: the statement starts with units already held, so their cost and dates are unknown`,
      unhandled: (fund: string, kind: string, date: string) =>
        `${fund}: a ${kind} transaction on ${date} is not handled`,
      kinds: { merger_in: "merger in", merger_out: "merger out", other: "other" },
      overLimit: (more: string, max: string) => `${more} more funds: the calculator holds ${max}`,
    },
    fund: {
      folio: (fund: string, folio: string) => `${fund} (folio ${folio})`,
      remove: "Remove",
      removeFund: (fund: string) => `Remove ${fund}`,
      loadFailed: (error: string) =>
        `This fund’s data could not be loaded (${error}). Choose its tax type below; the gain if sold today needs the latest NAV and is left out.`,
      taxedAs: "Taxed as",
      taxType: (fund: string) => `Tax type of ${fund}`,
      choose: "Choose how this fund is taxed",
      types: {
        equity: "Equity-oriented (65%+ Indian equity)",
        hybrid: "Hybrid (35-65% Indian equity)",
        debt: "Debt (over 65% in debt)",
        other: "Gold, silver, overseas or other FoF",
      },
      yourChoice: "Your choice.",
      fromCategory:
        "From the fund's SEBI category. Check the fund's own tax treatment and change it if it differs.",
      unsettled:
        "The category does not settle this, as it depends on the fund's equity share. Check the scheme documents.",
      loadingCategory: "Loading the fund's category...",
      listed: "Listed on a stock exchange (an ETF)",
      highestPrice2018: "Highest price on 31 Jan 2018",
      nav2018: "NAV on 31 Jan 2018",
      notInData: "Not in the data: enter it",
      value2018: (fund: string) => `31 Jan 2018 value of ${fund}`,
      grandfathers: "Grandfathers gains up to 31 Jan 2018 on units bought before February 2018.",
      listedHint:
        "For a listed unit this is the highest price it traded at on the exchange that day.",
      blankUsesData:
        "Blank uses the last January 2018 NAV in this site's data; check it against your statement.",
      noJan2018: "This site's data has no January 2018 NAV for the fund.",
      transactions: (n: number, shown: string) =>
        `${shown} ${plural(n, "transaction", "transactions")}`,
      transactionsImported: (n: number, shown: string) =>
        `${shown} ${plural(n, "transaction", "transactions")} from your statement`,
      type: "Type",
      rowType: (row: number) => `Row ${row} type`,
      purchase: "Purchase",
      redemption: "Redemption",
      date: "Date",
      rowDate: (row: number) => `Row ${row} date`,
      units: "Units",
      rowUnits: (row: number) => `Row ${row} units`,
      navPerUnit: "NAV per unit",
      amountRupees: "Amount (₹)",
      rowNav: (row: number) => `Row ${row} NAV`,
      rowAmount: (row: number) => `Row ${row} amount`,
      enterAs: "Enter as",
      rowValueKind: (row: number) => `Row ${row} value kind`,
      totalAmount: "Total amount",
      removeRow: "Remove row",
      removeRowN: (row: number) => `Remove row ${row}`,
      addTransaction: "+ Add a transaction",
      incomplete: (n: number, shown: string) =>
        `${plural(n, `${shown} row is`, `${shown} rows are`)} incomplete and not counted.`,
    },
    errors: {
      title: "Check these entries",
      sides: { buy: "buy", sell: "sell" },
      invalidDate: (fund: string, side: string, date: string) =>
        `${fund}, ${side} on ${date}: not a valid date`,
      futureDate: (fund: string, side: string, date: string) =>
        `${fund}, ${side} on ${date}: the date is in the future`,
      units: (fund: string, side: string, date: string) =>
        `${fund}, ${side} on ${date}: units must be above zero`,
      amount: (fund: string, side: string, date: string) =>
        `${fund}, ${side} on ${date}: the amount cannot be negative`,
      nav31Jan2018: (fund: string) => `${fund}: the 31 Jan 2018 NAV must be above zero`,
      slabRate: "The slab rate must be between 0% and 100%",
      oversold: (fund: string, date: string, units: string, held: string) =>
        `${fund}: the sale on ${date} is ${units} units but only ${held} are held then`,
    },
    act2025: (section: string) => `${section} (2025 Act)`,
    longTerm: "Long-term",
    shortTerm: "Short-term",
    badge: (term: string, section: string) => `${term}, ${section}`,
    badgeRate: (term: string, section: string, rate: string) => `${term}, ${section} at ${rate}`,
    slabSection: "slab",
    buckets: {
      "111A": (rate: string, section: string) => `Equity STCG at ${rate} (section ${section})`,
      "112A": (rate: string, section: string) => `Equity LTCG at ${rate} (section ${section})`,
      "112": (rate: string, section: string) => `Non-equity LTCG at ${rate} (section ${section})`,
      "112indexed": (rate: string, section: string) =>
        `Non-equity LTCG at ${rate} with indexation (section ${section})`,
      slab: "Short-term, taxed at your slab rate",
    },
    realised: "Realised gains by financial year",
    fy: (label: string) => `FY ${label}`,
    yearRange: (from: string, to: string) => `Sales from 1 April ${from} to 31 March ${to}`,
    notCovered: "Before FY 2018-19. Matched so later sales use the right units; tax not estimated.",
    incomplete: "Incomplete",
    incompleteHint:
      "Some units bought before February 2018 need their 31 Jan 2018 NAV. Their gains are left out until it is entered.",
    shortTermGains: "Short-term gains",
    longTermGains: "Long-term gains",
    netOfLosses: "Net of losses",
    exemptionUsed: "Equity LTCG exemption used",
    of: (limit: string) => `of ${limit}`,
    taxWithCess: "Estimated tax with cess",
    notEstimated: "Not estimated",
    plusSlabTax: (special: string) => `${special} plus tax on slab-rate gains`,
    gain: "Gain",
    afterSetOff: "After setting off losses",
    exempt: "Exempt",
    rate: "Rate",
    tax: "Tax",
    slabRate: "Slab",
    needsSlabRate: "Needs slab rate",
    cess: "Health and education cess at 4%",
    estimatedTax: "Estimated tax",
    lots: {
      title: "Lot by lot",
      subtitle:
        "Each sale split across the purchases it used up, oldest first. Cost used is after grandfathering or indexation.",
      fund: "Fund",
      bought: "Bought",
      sold: "Sold",
      units: "Units",
      cost: "Cost",
      costUsed: "Cost used",
      saleValue: "Sale value",
      treatment: "Treatment",
      needsNav: "Needs 31 Jan 2018 NAV",
    },
    open: {
      title: "Units still held",
      exemptionLeft: (fy: string) => `Equity LTCG exemption left in FY ${fy}`,
      ofAfterSales: (limit: string) => `of ${limit}, after the sales above`,
      ifSold: "If sold at the latest NAV",
      ifSoldHint:
        "The gain each lot would show at the latest published NAV, and whether it would be short or long-term. A description of the rules, not a suggestion to sell or hold.",
      value: "Value",
      today: "Today",
      longTermFrom: "Long-term from",
      never: "Never: always short-term",
      already: "Already",
    },
    sources: {
      title: "The rules applied, and where they come from",
      rules: {
        holding:
          "Holding period: equity-oriented fund units are long-term when held more than 12 months. Other units needed more than 36 months for sales before 23 Jul 2024; from that date listed units, ETFs included, need 12 and the rest 24. Units bought on 1 Jan complete 12 months on 31 Dec, so a sale on 1 Jan of the next year is long-term. Some statements count by days instead, which can differ by a day.",
        s111A:
          "Section 111A: short-term gains on equity-oriented fund units at 15%, and 20% for sales from 23 Jul 2024.",
        s112A:
          "Section 112A: long-term gains on equity-oriented fund units at 10%, and 12.5% for sales from 23 Jul 2024, above an exemption of Rs 1 lakh a year, Rs 1.25 lakh from FY 2024-25. In FY 2024-25 the Rs 1.25 lakh is one limit across both rates; the law does not say which gains it covers first, so it is applied to the 12.5% gains, the cheaper choice. It taxes sales from 1 Apr 2018; before that, section 10(38) exempted them, so earlier years are listed without tax.",
        grandfathering:
          "Grandfathering: for equity-oriented units bought before 1 Feb 2018, the cost is the higher of the actual cost and the lower of the value on 31 Jan 2018 and the sale value. That value is the NAV on 31 Jan 2018, or for a listed unit the highest price it traded at that day.",
        s112: "Section 112: long-term gains on other units at 20% with indexation for sales before 23 Jul 2024 (cost inflation index, base 2001-02 = 100), and 12.5% without indexation from that date. Short-term gains on these units are taxed at the slab rate.",
        s50AA:
          "Section 50AA (Finance Act 2023): gains on units of a specified mutual fund bought on or after 1 Apr 2023 are short-term however long they are held, at the slab rate. Up to FY 2024-25 a specified fund was one with no more than 35% in Indian equity, which caught gold, silver and international funds. The Finance (No. 2) Act 2024 narrowed it from FY 2025-26 to funds with more than 65% in debt and money market instruments, or 65% or more in such funds.",
        equityOriented:
          "Equity-oriented fund: at least 65% of its money in listed Indian equity, or a fund of funds with 90% in a listed fund that itself holds 90% in listed Indian equity. The fund type here comes from the SEBI category where that settles it; check your fund's own treatment.",
        setOff:
          "Set-off: a short-term loss can reduce any capital gain, a long-term loss only a long-term gain (sections 70 and 74). The law sets no order across rates, so losses are set against the highest rate first. Losses carried forward from earlier years are not included.",
        cess: "Health and education cess of 4% on the tax. Surcharge, which on these gains is capped at 15%, is not included.",
        act2025:
          "From 1 Apr 2026 the Income-tax Act 2025 replaces the 1961 Act with the same rules under new numbers: 111A is section 196, 112 is 197, 112A is 198 and 50AA is 76.",
      },
      documents: {
        bill2018: "Finance Bill 2018",
        bill2024: "Finance (No. 2) Bill 2024",
        memo2024: "Memorandum to the Finance (No. 2) Bill 2024",
        faq2024: "CBDT FAQs on the 2024 capital gains changes",
        act2025: "Income-tax Act 2025 (sections 2(101), 76, 90, 108, 196-198)",
        ramola: "Delhi High Court, Bharti Gupta Ramola v. CIT (2012)",
        cii: "Cost inflation index",
      },
    },
  },
  // Arrays are the text around inline code, in order: one more piece than there are codes.
  glossary: {
    metaTitle: "Mutual fund terms explained: rolling returns, drawdown, Sharpe",
    metaDescription:
      "Every metric on the screener in plain words: what it measures, which direction is better and where it misleads. Rolling returns, drawdown, Sharpe, Sortino, expense ratio, alpha and beta.",
    title: "Glossary",
    introBefore:
      "What each number on this site means and how to read it. For the formula behind any of them, and for the rules about when one is refused rather than computed, see ",
    introLink: "methodology",
    introAfter: ".",
    find: "Find a metric",
    sections: "Glossary sections",
    conceptsTitle: "Before you read any number",
    conceptsCount: (n: number) => `${n} ideas that the rest of this page assumes.`,
    howComputed: "How this is computed →",
    shown: (shown: number, total: number, query: string) =>
      `${shown} of ${total} metrics${query ? ` match “${query}”` : ""}`,
    noMatchBefore: (query: string) =>
      `Nothing matches “${query}”. Try the technical name, such as `,
    noMatchAfter: ".",
    direction: {
      higher_is_better: "Higher is better",
      lower_is_better: "Lower is better",
      context: "Neither direction is better",
    },
    // Keyed by the concept's anchor id, which every language keeps.
    concepts: {
      "past-return": {
        term: "Why every number here is history",
        body: "Every figure on this site describes what already happened. A fund that returned 18% a year for five years is a fund that returned 18% a year for five years; it is not a fund that will. Returns come from markets, and the market conditions that produced a past number are not repeatable to order. Use these numbers to understand how a fund has behaved - how it fell, how it recovered, how consistent it was, what it cost - rather than to forecast. Nothing here is advice, and nothing here is a prediction.",
      },
      "peer-group": {
        term: "Peer group, and why it is your sub-category",
        body: "A small-cap fund and a liquid fund are not comparable, so every relative number here compares a fund only with funds in its own SEBI sub-category - Flexi Cap with Flexi Cap, Small Cap with Small Cap. That group is the fund's peers. When you see 'similar funds' on this site, that is what it means. The peer average also leaves the fund itself out of the calculation, so a large fund is not partly measured against itself. If a sub-category has too few funds to make a fair average, the comparison is left blank rather than computed on a handful.",
      },
      "rolling-vs-trailing": {
        term: "Rolling returns, and why one 5-year number misleads",
        body: "A trailing 5-year return measures exactly one window: today back to five years ago. Move the start date a few months and the answer can change enormously, because it depends on whether you happened to begin at a market low or a high. A rolling return computes every possible 5-year window in the fund's history and shows the spread - typical, worst, best, and how often the window ended in profit. The worst window is usually the most informative number on the page: it is what an unlucky investor actually got. One trailing number hides all of that.",
      },
      drawdown: {
        term: "Drawdown: the worst fall",
        body: "A drawdown is the drop from a previous high point to the lowest point that followed, before a new high was reached. Maximum drawdown is the worst such fall on record. It matters more than volatility for most people, because it is the number that describes the moment you would have been most tempted to sell. Recovery time matters just as much: a 30% fall that took four years to make back is a very different experience from one recovered in eight months. This site computes drawdown on daily prices, because a month-end sample steps straight over the bottom.",
      },
      volatility: {
        term: "Volatility: how bumpy the ride was",
        body: "Volatility measures how much a fund's monthly returns bounced around their own average. High volatility means large swings in both directions; it is not the same thing as risk of loss, though the two often travel together. It is quoted as an annual percentage. On its own it says nothing about whether a fund made money - a fund can be volatile and excellent, or steady and poor. It is most useful next to return: two funds with the same return and different volatility gave their investors very different experiences.",
      },
      "expense-ratio": {
        term: "Expense ratio, and Direct versus Regular",
        body: "The expense ratio is the annual fee the fund house charges, as a percentage of your money. It is already deducted from the NAV, so every return on this site is after that fee - never subtract it again. A Direct plan is the same portfolio with no distributor commission; a Regular plan pays a commission out of your returns, typically 0.5-1% a year, which compounds into a large difference over a decade. They are separate scheme codes with separate NAVs. This site defaults to Direct plans for exactly that reason.",
      },
      "index-vs-active": {
        term: "Index funds versus active funds",
        body: "An index fund holds whatever an index holds, in the same proportions, and charges very little because no one is choosing. An active fund pays a manager to pick, and charges more for it. Neither is automatically better. The question a screener can help with is narrower and answerable: did this particular active fund actually beat its index, by enough to cover its extra cost, and did it do so consistently rather than once? Several columns here exist to answer that - excess versus the index, how reliably it beat it, and how much of its result the index alone explains.",
      },
      benchmark: {
        term: "Benchmark: the index a fund is measured against",
        body: "A benchmark is the index that represents what a fund is trying to do - Nifty 50 for a large-cap fund, Nifty Midcap 150 for a mid-cap one. Beating peers and beating the index are different achievements, and this site reports them separately. Where no suitable index series has been loaded for a fund's category, the index-relative columns are left blank with a stated reason rather than computed against something that does not fit. Some series here are built from an index fund's own NAV, which is net of that fund's costs, so it slightly understates the real index.",
      },
      survivorship: {
        term: "Survivorship: the funds that are not in the average",
        body: "Funds that performed badly often get merged into other funds or closed, and then they vanish from the list of funds you can screen today. Any average computed over surviving funds is therefore flattering, because the failures have been removed from it. This is not a small effect. This site measures it rather than only warning about it: category averages are computed twice, once over active funds and once including the ones that closed, and the gap between them is shown in percentage points wherever a category average appears.",
      },
      "blank-values": {
        term: "Why a number is blank",
        body: "A dash on this site never means zero and never means an error. It means the number could not be computed honestly, and clicking it tells you exactly why: too little history, too few comparable funds, no index loaded for that category, or a denominator that would make the ratio meaningless. The alternative - filling the gap with a category average or a zero - would make a fund with missing data look like a fund with ordinary data, which is worse than an obvious blank. Every reason has a name, and every name is explained where it appears.",
      },
      "p-value": {
        term: "What a p-value is doing on a fund screener",
        body: "When a fund beats its index, that can be skill or it can be luck. The p-value estimates how easily pure luck could have produced a result that good. A low p-value means luck is a poor explanation. The catch is scale: screen tens of thousands of funds and roughly 5% of them will clear the usual threshold by chance alone, with no skill whatsoever - which is over a thousand funds here. So a single impressive p-value found by screening is much weaker evidence than the same p-value found for a fund you were already examining. The methodology page states the expected false-positive count.",
      },
      "sip-vs-lumpsum": {
        term: "SIP versus lump sum",
        body: "Most people invest monthly rather than all at once, and the two produce genuinely different returns from the same fund. A trailing return assumes you put everything in on day one and took it all out at the end. A SIP return assumes a fixed amount every month, so money invested recently has had little time to compound while money from years ago has had a lot. When markets rose steeply early in the period, the lump-sum figure will look far better than anything a monthly investor actually received. Both are shown here, labelled separately.",
      },
    },
  },
  methodology: {
    metaTitle: "Methodology: how returns and risk are computed",
    metaDescription:
      "The exact definitions behind every figure: month-end CAGR, rolling return windows, leave-one-out peer averages, risk ratios, drawdowns and benchmark proxies, with their limitations.",
    title: "Methodology",
    introBefore:
      "The exact statement of how each number is computed, and when it is refused rather than computed. New to these terms? Start with the ",
    introLink: "glossary",
    introAfter: ", which says what each number means in plain language.",
    version: (version: string) => `Version ${version}`,
    metricsAsOf: (date: string) => `Metrics as of ${date}`,
    navRange: (from: string, to: string) => `NAV ${from} to ${to}`,
    sectionsLabel: "Methodology sections",
    // Keyed by section anchor id.
    sections: {
      frequency: "Frequency",
      "risk-free": "Risk-free rate",
      formulas: "Formulas",
      "peer-universe": "Peer universe",
      survivorship: "Survivorship bias",
      minimums: "Minimum observations",
      "alpha-significance": "Alpha significance",
      benchmarks: "Benchmarks",
      "data-quality": "Why a value is missing",
      catalog: "Metric catalog",
      sources: "Sources",
      limitations: "Limitations",
    },
    cards: {
      frequency: "Observation frequency and annualisation",
      "risk-free": "Risk-free rate",
      formulas: "Formulas",
      "peer-universe": "Peer universe",
      survivorship: "Survivorship bias, quantified",
      minimums: "Minimum observations before a metric is computed",
      "alpha-significance": "Alpha significance and multiple comparisons",
      benchmarks: "Benchmarks",
      "data-quality": "Why a value can be missing",
      catalog: "Metric catalog",
      sources: "Sources and attribution",
      limitations: "Limitations",
    },
    riskFree: (annual: string, monthly: string) => [
      `${annual} a year, converted geometrically to ${monthly} a month with `,
      ". A naive division by twelve would overstate the monthly hurdle. Change it with ",
      ".",
    ],
    // Keyed by the methodology document's formula key.
    formulas: {
      trailing_cagr: "Trailing CAGR over horizon h",
      rolling_cagr: "Rolling CAGR of the window ending at t",
      sharpe: "Sharpe ratio",
      sortino: "Sortino ratio",
      downside_deviation: "Downside deviation",
      volatility: "Annualised volatility",
      tracking_error: "Tracking error",
      information_ratio: "Information ratio",
      alpha_beta: "Alpha and beta regression",
      alpha_tstat: "Alpha t-statistic",
      alpha_pvalue: "Alpha p-value",
      max_drawdown: "Maximum drawdown",
      calmar: "Calmar ratio",
      peer_excess: "Excess return over peers",
      peer_ratio: "Ratio to peers",
      sip_xirr: "SIP return (XIRR)",
      basket_correlation: "Basket correlation",
      basket_blended_return: "Basket blended return",
      diversification_benefit: "Diversification benefit",
      capture_ratio: "Up and down capture",
      worst_calendar_year_return: "Worst calendar-year return",
      quartile_now: "Current peer quartile",
      quartile_persistence_3y: "Quartile persistence over 3 years",
      style_exposure: "Style exposure",
      style_drift_3y: "Style drift over 3 years",
      aum_family_latest: "Latest fund-family AUM",
      aum_growth_4q: "AUM growth over 4 quarters",
      aum_percentile_in_sub_category: "AUM percentile in sub-category",
    },
    formulasNote:
      "Standard deviations use the sample estimator (ddof = 1). Monthly statistics are annualised by sqrt(12); no metric mixes daily and monthly observations.",
    defaults: "Defaults",
    survivorshipSides: [
      "Every category aggregate (CAGR at 1, 3, 5 and 10 years) is computed twice: once over today's active schemes only, and once over every scheme in the category including ones that later closed or merged away. A category_key encodes which side it is with an ",
      " or ",
      " marker; the two keys for one category differ only in that marker.",
    ],
    survivorshipGap: [
      "",
      " returns both sides as ",
      " and ",
      ", plus ",
      ": the active-only CAGR minus the all-schemes CAGR at each horizon, in percentage points. A positive gap means the active-only average - the default shown everywhere else in this app - overstates the category by leaving out the funds that did not survive.",
    ],
    minimumsNote:
      "Below these thresholds the metric is null with a stated reason. Nothing is extrapolated, and NAV gaps are never forward-filled to manufacture an observation.",
    loadedSeries: "Loaded series",
    seriesMonths: (currency: string, months: string) => `${currency} · ${months} months`,
    noneLoaded: "None loaded.",
    reasonsIntro:
      "Every blank on this site carries one of these reasons; click a blank to see which.",
    catalogColumns: {
      metric: "Metric",
      definition: "Definition",
      better: "Better",
      caveat: "Caveat",
    },
    better: { higher_is_better: "Higher", lower_is_better: "Lower", context: "Neither" },
    survivorshipLimitation: [
      "Survivorship bias: this site publishes today's active schemes only, so historical screening here will not see funds that closed or merged. The API (",
      ') keeps them, and "Survivorship bias, quantified" above shows how it measures the gap per category.',
    ],
  },
  fund: {
    metaTitle: (name: string) => `${name}: rolling returns, risk and peers`,
    metaDescription: (name: string, subCategory: string | null, rolling: string | null) =>
      `${name}${subCategory ? ` (${subCategory})` : ""}. ${rolling ?? "Trailing and rolling returns."} Risk and peer comparison from AMFI NAV history. Not investment advice.`,
    rollingSummary: (count: string, years: number, min: string, max: string, median: string) =>
      `Over ${count} rolling ${years}-year windows the return ranged from ${min} to ${max} a year, with a median of ${median}.`,
    horizon: (years: number) => `${years}Y`,
    active: "Active",
    inactive: "Inactive or matured",
    inactiveShort: "Inactive / matured",
    notMapped: "not mapped",
    notPublished: "not published",
    noMetrics: {
      identity: (amc: string, subCategory: string, code: string) =>
        `${amc} · ${subCategory} · scheme code ${code}`,
      title: "No metrics for this scheme",
      status: "Status",
      navDates: "NAV dates published",
      navRange: (from: string, to: string) => `${from} to ${to}`,
      planOption: "Plan / option",
      category: "Category",
      kept: "The scheme is kept in the raw data exactly as the source publishes it. It is excluded from screens and peer groups because no return can be formed from it, not because it was filtered out by a preference.",
    },
    header: {
      identity: (code: string, isin: string) => `Scheme code ${code} · ${isin}`,
      noIsin: "no ISIN published",
      fullDistribution: "Full distribution",
      compare: "Compare with other funds",
      print: "Print one-page summary",
      latestNav: "Latest NAV",
      asOf: (date: string) => `as of ${date}`,
      loading: "Loading fund...",
    },
    // Split around the emphasised names, which the component renders between the parts.
    categoryChange: {
      onDate: "This fund changed category on ",
      from: ", from ",
      to: " to ",
      after:
        ". Every figure below that compares this fund to its peers spans both periods, so the peer group it is measured against is not the same one throughout the window.",
    },
    currencyWithheld: {
      before: "Benchmark-relative metrics are withheld. This fund is mapped to ",
      after: (currency: string, fundCurrency: string) =>
        `, which is quoted in ${currency}, while the NAV is in ${fundCurrency}. The difference between them would include the exchange rate, not just performance, so no alpha, beta, tracking error, benchmark information ratio or benchmark excess return is computed. Import an ${fundCurrency}-converted series to compare against this index.`,
    },
    staleBenchmark: {
      before: "Benchmark figures below were computed against ",
      remapped: ", but this fund is now mapped to ",
      run: ". Run ",
      after:
        " to recompute them; until then treat every benchmark-relative number here as out of date.",
    },
    glance: {
      label: "Trailing returns at a glance",
      oneYear: "1-year return",
      perYear: (years: number) => `${years}-year return, per year`,
      peersFrom3: "Peer figures start at 3 years",
      vsSimilar: "vs similar funds",
    },
    onThisPage: "On this page",
    sections: {
      returns: "Returns",
      charts: "Charts",
      rolling: "Rolling",
      risk: "Risk",
      behaviour: "Falls and style",
      peers: "Peers",
      missing: "Missing values",
    },
    stats: {
      aum: "Scheme AAUM (Quarterly Average, ₹ Cr)",
      aumTooltip:
        "This is AMFI quarterly average AUM for this exact scheme variant, such as Direct Growth. It is not a current month-end AUM and does not include related Direct/Regular or Growth/IDCW variants.",
      age: "Fund age",
      since: (date: string) => `from ${date}`,
      expenseRatio: "Expense ratio",
      plan: (plan: string) => `${plan} plan`,
      comparableMonths: "Comparable months",
      gapMonths: (n: string) => `${n} gap months`,
      metricsAsOf: "Metrics as of",
      benchmark: "Benchmark",
      notComparable: (currency: string) => `not comparable with ${currency} returns`,
    },
    dataQuality: "Data quality flags",
    returns: {
      title: "Trailing returns",
      subtitle: "Annualised, from month-end NAV to month-end NAV.",
      horizon: "Horizon",
      fundCagr: "Fund CAGR",
      subCategoryCagr: "Sub-category CAGR",
      excess: "Excess (pp)",
      ratio: "Ratio",
      peers: "Peers",
      benchmarkCagr: "Benchmark CAGR",
      excessBenchmark: "Excess vs benchmark (pp)",
      note: "Peer and benchmark comparisons are stored for 3Y, 5Y and 10Y only. The peer comparison below covers 1Y as well.",
    },
    rolling: {
      title: "Rolling return distribution",
      subtitle: "Every overlapping window in the fund's comparable history.",
      stats: {
        mean: "mean",
        median: "median",
        min: "min",
        max: "max",
        std: "dispersion",
        positive_pct: "positive %",
      },
      beatSubCategory: "Beat sub-category",
      beatBenchmark: "Beat benchmark",
      windows: "Windows",
    },
    risk: {
      title: "Risk and risk-adjusted metrics",
      subtitle: "Monthly observations, annualised by sqrt(12). Maximum drawdown uses daily NAV.",
      metric: "Metric",
      // Keyed by the metric's name without its horizon suffix.
      rows: {
        sharpe: "Sharpe",
        sortino: "Sortino",
        volatility: "Volatility (annualised)",
        downside_deviation: "Downside deviation",
        max_drawdown: "Maximum drawdown",
        calmar: "Calmar",
        tracking_error: "Tracking error",
        alpha: "Alpha (annualised)",
        beta: "Beta",
        r_squared: "R-squared",
        information_ratio_vs_category: "Information ratio vs sub-category",
        information_ratio_vs_benchmark: "Information ratio vs benchmark",
      },
    },
    missing: {
      title: "Why is a score missing?",
      subtitle: "Every blank on this page traces to one of these reasons.",
    },
    howComputed: "Read how every one of these numbers is computed",
    notForecast: ". Past returns are not a forecast.",
    drawdowns: {
      title: "Falls and recoveries",
      subtitle: (depth: string) =>
        `Every distinct fall of ${depth} or more from a daily-NAV high, worst first. An episode ends when the old high is regained, so 2020 and 2022 are counted separately.`,
      none: (depth: string) =>
        `No fall of ${depth} or more in the NAV history held for this scheme. For a fund launched after the last correction that says more about its age than about its resilience.`,
      fall: "Fall",
      from: "From",
      to: "To",
      timeDown: "Time down",
      backToEven: "Back to even",
      stillBelow: "still below this peak",
    },
    capture: {
      insufficient: (years: number) =>
        `Up and down capture need at least 24 months shared with the peer group over the trailing ${years} years.`,
      upHint: "Share of the peer group's gain taken when peers rose. Above 1 is more.",
      downHint:
        "Share of the peer group's loss taken when peers fell. Below 1 is less, and better.",
      basis: (years: number) =>
        `Over the trailing ${years} years, against the equal-weighted return of this fund's sub-category with the fund itself left out. Not a benchmark index: capture against peers and capture against an index are different numbers. This is the same figure the screener sorts on.`,
    },
    calendar: {
      title: "Calendar year returns",
      beaten: (beaten: number, comparable: number) =>
        `Beat its sub-category in ${beaten} of ${comparable} calendar years. A trailing CAGR averages these away; this is the run of years it averaged.`,
      noPeers: "No peer comparison is available for these years.",
      year: "Year",
      subCategory: "Sub-category",
      difference: "Difference",
      partial: (months: number) => `(${months} mo, partial)`,
    },
    cost: {
      title: "Cost against its peers",
      subtitle:
        "Returns on this page are already net of the expense ratio, so this is not a second deduction. It is what the fee difference compounds to.",
      noTer:
        "No expense ratio published for this scheme, so no comparison is possible. AMFI's TER disclosure carries no scheme code, so it is matched by name, and a value is never inferred from a similar fund.",
      tooFew: (n: number) =>
        `Only ${n} ${plural(n, "peer", "peers")} in this sub-category publish an expense ratio, which is too few for a median.`,
      thisFund: "This fund",
      median: (n: number) => `Sub-category median (${n} ${plural(n, "fund", "funds")})`,
      feeGap: (years: number) => `Fee gap over ${years} years`,
      cheaper: (years: number, gap: string) =>
        `Cheaper than the median peer. Holding it for ${years} years leaves ${gap} more in the fund than the median would, before any difference in what the manager returns.`,
      dearer: (years: number, gap: string) =>
        `Dearer than the median peer. Holding it for ${years} years leaves ${gap} less in the fund than the median would, which the manager has to earn back before you are level.`,
    },
    exposure: {
      title: "Estimated exposure",
      subtitle:
        "AMFI publishes no portfolio for any Indian fund, so this is inferred from how the NAV moved, not read from holdings. It is the long-only mix of index returns that best explains this fund's monthly returns.",
      none: "No exposure can be estimated for this fund.",
      basisMismatch: (rSquared: string | null) =>
        `The Indian equity indices in the basis explain too little of its movement${rSquared === null ? "" : ` (R-squared ${rSquared})`} for any weighting to mean something. That is the expected answer for a fund investing outside India, or in gold or debt.`,
      tooShort: (months: number) =>
        `Fitting needs at least 24 months shared with every index in the basis; this fund has ${months}.`,
      fitted: (months: number, from: string, to: string) =>
        `Fitted over ${months} months, ${from} to ${to}.`,
      explains: (share: string) =>
        `The mix explains ${share} of this fund's month-to-month movement.`,
    },
    drift: {
      title: "Style drift",
      subtitle:
        "Inferred from NAV, not a holdings statement: each band is the fitted mix of the same style-factor basis as above, refit on a rolling 36-month window and stepped one month at a time.",
      drift3y: "Style drift (3Y)",
      fittedWindows: "Fitted windows",
      omitted: "Omitted (weak fit)",
      fewWindows:
        "Fewer than 2 windows in the last 3 years cleared the R-squared floor, so no single drift figure is reported.",
      noHistory: "Not enough shared history with the basis to fit even one 36-month window.",
    },
    peers: {
      title: "Peer comparison",
      subtitle:
        "Against the mean of active Direct Growth peers in the fund's peer group, with the fund itself left out.",
      // Split around the command, which the component renders as code.
      otherGroups:
        "Other peer groups (whole category, Regular plans, IDCW options, median) are recomputed on request, so only the API (",
      otherGroupsAfter: ") serves them.",
      excess: "Excess",
      peerCount: "Peer count",
      universe: (size: string, label: string) => `Peer universe (${size} schemes in ${label})`,
    },
    attributes: {
      title: "Scheme attributes",
      subtitle:
        "Riskometer, exit load, lock-in, minimums, SID benchmark and fund manager. Third-party facts, not computed from NAV - never used in a return, risk figure or ranking anywhere on this site.",
      fields: {
        riskometer: "Riskometer",
        exit_load_pct: "Exit load",
        exit_load_period_days: "Exit load period",
        lock_in_days: "Lock-in",
        min_investment: "Minimum investment",
        min_sip: "Minimum SIP",
        benchmark_name: "Benchmark (per SID)",
        fund_manager: "Fund manager",
        manager_tenure_years: "Manager tenure",
      },
      stale: "stale",
      staleHint: "This value is stale.",
      source: (source: string, url: string | null) => `Source: ${source}${url ? ` (${url})` : ""}.`,
      noSource: "No enrichment source has published attributes for this scheme yet.",
      blankNote:
        "A blank cell names its own reason on hover rather than defaulting to zero or “no load”.",
    },
    charts: {
      scaleBreak: (date: string) =>
        `NAV scale change on ${date}: a face-value redenomination or unit split, filed as a raw NAV jump. Earlier NAVs are in different units, so every metric here starts at that month.`,
      rollingTitle: (years: number) => `Rolling ${years}-year annualised return`,
      rollingSubtitle: "Each point is the annualised return of the window ending on that month.",
      windowLength: "Window length",
      stats: {
        mean: "Mean",
        median: "Median",
        min: "Minimum",
        max: "Maximum",
        std: "Dispersion",
        positive_pct: "Positive",
      },
      windows: (n: number, reason: string | null) =>
        `n=${n} windows${reason ? ` · ${reason}` : ""}. Overlapping windows share months, so they are not independent observations.`,
      loading: "Loading rolling series...",
      navTitle: "Month-end NAV",
      navAsFiled: "Every NAV as filed with AMFI, including the step at the redenomination.",
      navSeries: "The series every metric on this page is computed from.",
    },
    // The printed one-page summary, in shorter words than the page to fit one sheet.
    print: {
      code: (code: string) => `code ${code}`,
      nav: (nav: string, date: string) => `NAV ${nav} (${date})`,
      aum: (aum: string, age: string) => `AUM ${aum} · age ${age}`,
      ter: (ter: string, benchmark: string) => `TER ${ter} · benchmark ${benchmark}`,
      notComparable: (benchmark: string, currency: string) =>
        `${benchmark} (${currency}, not comparable)`,
      trailing: "Trailing returns (annualised)",
      subCategory: "Sub-cat.",
      mean: "Mean",
      positive: "Positive %",
      beatSubCategory: "Beat sub-cat.",
      beatBenchmark: "Beat bmk.",
      risk: {
        sharpe: "Sharpe",
        sortino: "Sortino",
        volatility: "Volatility",
        max_drawdown: "Max drawdown",
        calmar: "Calmar",
        alpha: "Alpha",
        beta: "Beta",
        tracking_error: "Tracking error",
      },
      noFall: (depth: string) => `No fall of ${depth} or more on record.`,
      moreFalls: (n: number) => `${n} more ${plural(n, "fall", "falls")}, see full page.`,
      capture: (value: string) => `Up/down capture: ${value}`,
      captureUnavailable: (reason: string | null) =>
        `not available (${reason ?? "insufficient history"})`,
      cost: "Cost against peers",
      noTer: "No expense ratio published for this scheme.",
      tooFew: (n: number) => `Only ${n} ${plural(n, "peer", "peers")} publish an expense ratio.`,
      costLine: (ter: string, median: string, n: number, years: number, gap: string) =>
        `TER ${ter} vs sub-category median ${median} (${n} ${plural(n, "fund", "funds")}); fee gap over ${years} years ${gap}.`,
      exposure: "Estimated style exposure",
      noExposure: (reason: string) => `No exposure can be estimated: ${reason}`,
      notEnoughHistory: "not enough history",
      fit: (weights: string, rSquared: string, months: number, drift: string) =>
        `${weights} · fit R-squared ${rSquared} over ${months} months. 3Y style drift: ${drift}.`,
      missing: "Why a number is missing",
      methodology: (version: string, date: string) => `Methodology v${version}, as of ${date}.`,
    },
  },
  // Text the data pipeline writes, keyed by its English with each number as a {n} slot;
  // see `td` in lib/i18n/core.ts. English is the source, so it has nothing to map.
  data: {} as Record<string, string>,
};

export type Messages = typeof en;

export default en;
