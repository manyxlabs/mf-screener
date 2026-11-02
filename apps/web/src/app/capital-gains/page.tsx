import type { Metadata } from "next";
import { CapitalGainsClient } from "./capital-gains-client";

export const metadata: Metadata = {
  title: "Mutual fund capital gains calculator | Indian Mutual Fund Screener",
  description:
    "Estimate capital gains on Indian mutual fund units by financial year: FIFO lots, short and long-term gains under sections 111A, 112 and 112A, and the tax. An estimate, not tax advice.",
};

export default function CapitalGainsPage() {
  return <CapitalGainsClient />;
}
