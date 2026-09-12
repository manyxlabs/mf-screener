import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SchemeSearch } from "./scheme-search";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const searchSchemes = vi.fn();
vi.mock("@/lib/api", () => ({ searchSchemes: (...args: unknown[]) => searchSchemes(...args) }));

const RESULT = {
  scheme_code: "S01",
  scheme_name: "Alpha Mid Cap Fund",
  amc: "Alpha AMC",
  clean_sub_category: "Mid Cap Fund",
  clean_plan: "Direct",
  clean_option: "Growth",
};

beforeEach(() => {
  push.mockClear();
  searchSchemes.mockReset();
});

async function typeAndFlush(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
  await waitFor(() => expect(searchSchemes).toHaveBeenCalled());
}

describe("SchemeSearch", () => {
  it("renders plan and option on each result", async () => {
    searchSchemes.mockResolvedValue({ query: "alpha", items: [RESULT] });
    render(<SchemeSearch />);
    const input = screen.getByRole("combobox");
    await typeAndFlush(input, "alpha");
    await screen.findByText("Alpha Mid Cap Fund");
    expect(screen.getByText(/Direct/)).toBeDefined();
    expect(screen.getByText(/Growth/)).toBeDefined();
  });

  it("renders a real empty state rather than a spinner", async () => {
    searchSchemes.mockResolvedValue({ query: "zzz", items: [] });
    render(<SchemeSearch />);
    const input = screen.getByRole("combobox");
    await typeAndFlush(input, "zzz");
    await screen.findByText(/No schemes match/);
  });

  it("navigates to the fund page on Enter", async () => {
    searchSchemes.mockResolvedValue({ query: "alpha", items: [RESULT] });
    render(<SchemeSearch />);
    const input = screen.getByRole("combobox");
    await typeAndFlush(input, "alpha");
    await screen.findByText("Alpha Mid Cap Fund");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/fund/S01");
  });

  it("closes the panel on Escape", async () => {
    searchSchemes.mockResolvedValue({ query: "alpha", items: [RESULT] });
    render(<SchemeSearch />);
    const input = screen.getByRole("combobox");
    await typeAndFlush(input, "alpha");
    await screen.findByText("Alpha Mid Cap Fund");
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Alpha Mid Cap Fund")).toBeNull());
  });
});
