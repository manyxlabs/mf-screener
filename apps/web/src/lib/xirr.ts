export type CashFlow = { date: string; amount: number };

const DAY_MS = 86_400_000;

/**
 * Annualised internal rate of return over dated cash flows, on Excel's XIRR convention
 * (actual days over 365). Money paid in is negative, money taken out positive. Null when the
 * flows do not change sign, so no rate can balance them.
 */
export function xirr(flows: CashFlow[]): number | null {
  if (!flows.some((f) => f.amount > 0) || !flows.some((f) => f.amount < 0)) return null;
  const t0 = Math.min(...flows.map((f) => Date.parse(f.date)));
  const points = flows.map((f) => ({
    years: (Date.parse(f.date) - t0) / DAY_MS / 365,
    amount: f.amount,
  }));
  const npv = (rate: number) =>
    points.reduce((sum, p) => sum + p.amount / (1 + rate) ** p.years, 0);

  // Bisection rather than Newton: it cannot diverge or jump to a second root, and a
  // bracket from -99.99% to +1,000,000% covers any return a fund statement can show.
  let lo = -0.9999;
  let hi = 1e4;
  let flo = npv(lo);
  if (Math.sign(flo) === Math.sign(npv(hi))) return null;
  for (let i = 0; i < 200 && hi - lo > 1e-10; i++) {
    const mid = (lo + hi) / 2;
    const fmid = npv(mid);
    if (Math.sign(fmid) === Math.sign(flo)) {
      lo = mid;
      flo = fmid;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}
