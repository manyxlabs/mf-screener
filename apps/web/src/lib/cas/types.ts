// What a CAMS/KFintech Consolidated Account Statement (CAS) holds once parsed. The portfolio
// checkup and the capital gains calculator both work from this shape, so a statement is read
// once in the browser and never sent anywhere.

/** ISO date, YYYY-MM-DD. */
export type IsoDate = string;

export type CasTransactionKind =
  | "purchase" // lump sum or SIP
  | "redemption"
  | "switch_in"
  | "switch_out"
  | "dividend_reinvest"
  | "dividend_payout"
  | "bonus"
  | "merger_in"
  | "merger_out"
  | "stamp_duty"
  | "stt"
  | "tds"
  | "other";

export type CasTransaction = {
  date: IsoDate;
  kind: CasTransactionKind;
  /** As printed. Redemptions and switches out carry negative units and amounts. */
  units: number;
  amount: number;
  nav: number | null;
  description: string;
};

export type CasScheme = {
  name: string;
  amc: string;
  folio: string;
  isin: string | null;
  /** AMFI scheme code, when the statement prints one; otherwise matched later through the ISIN. */
  amfiCode: string | null;
  openingUnits: number;
  closingUnits: number;
  transactions: CasTransaction[];
  /** The statement's own valuation at its closing date, when printed. */
  valuation: { date: IsoDate; nav: number; value: number } | null;
};

export type CasStatement = {
  investorName: string | null;
  period: { from: IsoDate; to: IsoDate } | null;
  schemes: CasScheme[];
};
