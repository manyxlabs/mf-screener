import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_FILTERS } from "@/lib/screen-query";
import { FilterDrawer } from "./filter-drawer";

const facets = {
  categories: [],
  sub_categories: [],
  cap_bands: [],
  styles: [],
  amcs: [],
  plans: ["Direct", "Regular"],
  options: ["Growth", "IDCW Payout"],
};

function open(overrides = {}, metrics: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  render(
    <FilterDrawer
      open
      onClose={() => {}}
      filters={{ ...DEFAULT_FILTERS, ...overrides }}
      onChange={onChange}
      metrics={metrics as never}
      facets={facets as never}
    />,
  );
  return onChange;
}

const cagr5y = {
  name: "cagr_5y",
  label: "CAGR 5Y",
  unit: "percent",
  definition: "d",
  period: "5 years",
  frequency: "monthly",
  direction: "higher_is_better",
  caveat: "c",
  plain_label: "Past return per year (5Y)",
  plain_definition: "p",
  group: "Returns",
};

describe("FilterDrawer", () => {
  it("offers the one-row-per-fund toggle, on by default", () => {
    open();
    const toggle = screen.getByLabelText(/One row per fund/);
    expect((toggle as HTMLInputElement).checked).toBe(true);
  });

  it("turns family grouping off and resets to the first page", () => {
    const onChange = open();
    fireEvent.click(screen.getByLabelText(/One row per fund/));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeFamilies: false, page: 1 }),
    );
  });

  it("explains what turning it off means rather than silently widening the result set", () => {
    open({ dedupeFamilies: false });
    expect(screen.getByText(/separate scheme codes for one fund/)).toBeDefined();
  });

  it("says nothing extra while the default is in force", () => {
    open();
    expect(screen.queryByText(/separate scheme codes for one fund/)).toBeNull();
  });

  // The drawer used to ask for 0.12 and explain itself in hint text. The API still
  // takes the decimal; only what the user types and reads is a whole percent.
  describe("percent fields", () => {
    it("sends 12% to the API as 0.12", () => {
      const onChange = open({}, { cagr_5y: cagr5y });
      fireEvent.change(screen.getByLabelText(/Past return per year \(5Y\) minimum, in percent/), {
        target: { value: "12" },
      });
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ ranges: { cagr_5y_min: 0.12 } }),
      );
    });

    it("shows a stored 0.07 as 7, not 7.000000000000001", () => {
      open({ ranges: { cagr_5y_min: 0.07 } }, { cagr_5y: cagr5y });
      const input = screen.getByLabelText(
        /Past return per year \(5Y\) minimum, in percent/,
      ) as HTMLInputElement;
      expect(input.value).toBe("7");
    });

    it("clears the filter rather than sending zero when emptied", () => {
      const onChange = open({ ranges: { cagr_5y_min: 0.12 } }, { cagr_5y: cagr5y });
      fireEvent.change(screen.getByLabelText(/Past return per year \(5Y\) minimum, in percent/), {
        target: { value: "" },
      });
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ ranges: {} }));
    });

    it("leads with the plain label and drops the decimal hint", () => {
      open({}, { cagr_5y: cagr5y });
      expect(screen.getByText("Past return per year (5Y)")).toBeDefined();
      expect(screen.queryByText(/as a decimal/)).toBeNull();
    });
  });
});
