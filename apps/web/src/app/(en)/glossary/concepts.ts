import type { Messages } from "@/messages/en";

/**
 * The twelve ideas a beginner needs before any column on this site means anything.
 *
 * These are the only hand-written entries in the glossary; everything else is
 * generated from the metric catalogue the API already serves. Their prose lives in the
 * message catalogue under `glossary.concepts`, keyed by slug. Each one ends at a
 * `/methodology` anchor, which stays the canonical statement of how a number is
 * actually computed. Keep them under about 120 words, and keep them descriptive -
 * nothing here tells the reader what to buy.
 */
export type Concept = {
  /** The entry's anchor id, the same in every language. */
  slug: keyof Messages["glossary"]["concepts"];
  /** Anchor on /methodology that proves or expands the claim. */
  methodologyAnchor: string;
};

export const CONCEPTS: Concept[] = [
  { slug: "past-return", methodologyAnchor: "limitations" },
  { slug: "peer-group", methodologyAnchor: "peer-universe" },
  { slug: "rolling-vs-trailing", methodologyAnchor: "rolling" },
  { slug: "drawdown", methodologyAnchor: "drawdown" },
  { slug: "volatility", methodologyAnchor: "risk" },
  { slug: "expense-ratio", methodologyAnchor: "peer-universe" },
  { slug: "index-vs-active", methodologyAnchor: "benchmarks" },
  { slug: "benchmark", methodologyAnchor: "benchmarks" },
  { slug: "survivorship", methodologyAnchor: "survivorship" },
  { slug: "blank-values", methodologyAnchor: "data-quality" },
  { slug: "p-value", methodologyAnchor: "alpha-significance" },
  { slug: "sip-vs-lumpsum", methodologyAnchor: "sip-xirr" },
];
