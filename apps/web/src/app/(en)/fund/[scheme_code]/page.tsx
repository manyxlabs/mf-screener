import type { MetricSpec, SchemeDetail } from "@mf/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { ApiError, getColumns, getScheme, getSchemeMetrics } from "@/lib/api";
import { categoryPageFor, categoryPath } from "@/lib/categories";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata, SITE_URL } from "@/lib/site";
import { exportedFundCodes } from "@/lib/static-data.server";
import { FundBreadcrumbs, FundView, NoMetrics } from "./fund-view";
import { rollingSpreads, rollingSummary } from "./rolling-summary";

type Params = { params: Promise<{ scheme_code: string }> };

export const dynamicParams = false;

export const generateStaticParams = async () =>
  (await exportedFundCodes()).map((scheme_code) => ({ scheme_code }));

const specsOf = async () =>
  new Map<string, MetricSpec>((await getColumns()).metrics.map((m) => [m.name, m]));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const code = (await params).scheme_code;
  const detail = await getScheme(code);
  const { scheme } = detail;
  // English only: the one URL serves every language, translated in the browser.
  const i18n = await getI18n("en");
  const rolling = detail.metrics_unavailable
    ? null
    : rollingSummary(rollingSpreads(await getSchemeMetrics(code), await specsOf(), [3]), i18n);
  return pageMetadata(
    i18n,
    `/fund/${code}/`,
    i18n.t.fund.metaTitle(scheme.scheme_name),
    i18n.t.fund.metaDescription(scheme.scheme_name, scheme.clean_sub_category, rolling),
  );
}

/** The trail and structured data every fund page carries, metrics or not. */
async function FundContext({ scheme }: { scheme: SchemeDetail["scheme"] }) {
  const category = await categoryPageFor(scheme.clean_sub_category);
  const path = `/fund/${scheme.scheme_code}/`;
  const isins = [scheme.isin_growth, scheme.isin_dividend].filter(Boolean);
  return (
    <>
      <FundBreadcrumbs
        parent={category ? [category.subCategory, categoryPath(category)] : null}
        name={scheme.scheme_name}
        path={path}
      />
      <JsonLd
        data={{
          "@type": "InvestmentFund",
          name: scheme.scheme_name,
          url: `${SITE_URL}${path}`,
          category: scheme.clean_sub_category ?? undefined,
          provider: scheme.amc ? { "@type": "Organization", name: scheme.amc } : undefined,
          identifier: [
            { "@type": "PropertyValue", propertyID: "AMFI scheme code", value: scheme.scheme_code },
            ...isins.map((value) => ({ "@type": "PropertyValue", propertyID: "ISIN", value })),
          ],
        }}
      />
    </>
  );
}

export default async function FundPage({ params }: Params) {
  const { scheme_code: code } = await params;
  let detail;
  try {
    detail = await getScheme(code);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  if (detail.metrics_unavailable) {
    return (
      <div className="space-y-5">
        <FundContext scheme={detail.scheme} />
        <NoMetrics scheme={detail.scheme} reason={detail.metrics_unavailable.description} />
      </div>
    );
  }
  const [metrics, specs] = await Promise.all([getSchemeMetrics(code), specsOf()]);
  return (
    <div className="space-y-5">
      <FundContext scheme={detail.scheme} />
      <FundView detail={detail} rolling={rollingSpreads(metrics, specs)} />
    </div>
  );
}
