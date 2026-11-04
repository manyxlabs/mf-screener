import { pageMetadata } from "@/lib/site";
import { PortfolioClient } from "./portfolio-client";

export const metadata = pageMetadata(
  "/portfolio/",
  "CAS portfolio analysis: holdings, XIRR, allocation and costs",
  "Read your CAMS/KFintech consolidated account statement in the browser: holdings at the latest NAV, XIRR, allocation and what expense ratios cost in rupees. Nothing is uploaded.",
);

export default function PortfolioPage() {
  return <PortfolioClient />;
}
