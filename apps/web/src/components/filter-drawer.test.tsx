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

function open(overrides = {}) {
  const onChange = vi.fn();
  render(
    <FilterDrawer
      open
      onClose={() => {}}
      filters={{ ...DEFAULT_FILTERS, ...overrides }}
      onChange={onChange}
      metrics={{}}
      facets={facets as never}
    />,
  );
  return onChange;
}

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
});
