import type { MetricSpec } from "@mf/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricValue, MissingValue } from "./metric-cell";

const excessSpec: MetricSpec = {
  name: "fund_minus_category_5y",
  label: "Excess vs sub-category 5Y",
  unit: "percentage_points",
  definition: "d",
  period: "5 years",
  frequency: "monthly",
  direction: "higher_is_better",
  caveat: "c",
  plain_label: "Ahead of / behind similar funds (5Y)",
  plain_definition: "p",
  group: "Vs similar funds",
};

const cagrSpec: MetricSpec = { ...excessSpec, name: "cagr_5y", label: "CAGR 5Y", unit: "percent" };

describe("MetricValue", () => {
  it("formats a return as a percentage to two decimals", () => {
    render(<MetricValue value={0.1234} spec={cagrSpec} />);
    expect(screen.getByText("12.34%")).toBeDefined();
  });

  it("pairs the excess marker with screen-reader text, never colour alone", () => {
    const { container } = render(<MetricValue value={0.0123} spec={excessSpec} />);
    expect(container.textContent).toContain("+1.23 pp");
    expect(screen.getByText(/above peers/)).toBeDefined();
  });

  it("renders a plain dash for a missing value", () => {
    const { container } = render(<MetricValue value={null} spec={cagrSpec} />);
    expect(container.textContent?.trim()).toBe("-");
  });

  it("keeps the reason available on the missing value", () => {
    render(
      <MissingValue
        reason="insufficient_peer_universe"
        description="Too few eligible peer schemes."
      />,
    );
    expect(screen.getByRole("button", { name: /explain/i })).toBeDefined();
  });
});
