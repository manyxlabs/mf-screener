import type { Metadata } from "next";
import { PortfolioClient } from "./portfolio-client";

export const metadata: Metadata = {
  title: "Portfolio checkup - Indian Mutual Fund Screener",
  description:
    "Read your CAMS/KFintech consolidated account statement in the browser: holdings at the latest NAV, XIRR, allocation and what expense ratios cost in rupees. Nothing is uploaded.",
};

export default function PortfolioPage() {
  return <PortfolioClient />;
}
