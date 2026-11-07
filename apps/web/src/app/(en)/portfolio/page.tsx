import { routeI18n, type LocaleParams } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/site";
import { PortfolioClient } from "./portfolio-client";

export async function generateMetadata({ params }: LocaleParams) {
  const i18n = await routeI18n(params);
  const { metaTitle, metaDescription } = i18n.t.portfolio;
  return pageMetadata(i18n, "/portfolio/", metaTitle, metaDescription);
}

export default function PortfolioPage() {
  return <PortfolioClient />;
}
