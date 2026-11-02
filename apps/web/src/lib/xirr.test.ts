import { describe, expect, it } from "vitest";
import { xirr } from "./xirr";

describe("xirr", () => {
  it("matches the worked example in Excel's XIRR documentation", () => {
    const rate = xirr([
      { date: "2008-01-01", amount: -10000 },
      { date: "2008-03-01", amount: 2750 },
      { date: "2008-10-30", amount: 4250 },
      { date: "2009-02-15", amount: 3250 },
      { date: "2009-04-01", amount: 2750 },
    ]);
    expect(rate).toBeCloseTo(0.373362535, 6);
  });

  it("finds a loss, and refuses flows that never change sign", () => {
    expect(
      xirr([
        { date: "2021-01-01", amount: -1000 },
        { date: "2022-01-01", amount: 500 },
      ]),
    ).toBeCloseTo(-0.5, 3);
    expect(xirr([{ date: "2020-01-01", amount: -1000 }])).toBeNull();
  });
});
