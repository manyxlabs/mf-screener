import type { MetricSpec, SchemeDetail } from "@mf/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, JsonLd } from "@/components/json-ld";
import { Card } from "@/components/ui";
import { ApiError, getColumns, getScheme, getSchemeMetrics } from "@/lib/api";
import { categoryPageFor, categoryPath } from "@/lib/categories";
import { pageMetadata, SITE_URL } from "@/lib/site";
import { exportedFundCodes } from "@/lib/static-data.server";
import { rollingSummary } from "./rolling-summary";
import { FundView } from "./fund-view";

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
  const rolling = detail.metrics_unavailable
    ? null
    : rollingSummary(await getSchemeMetrics(code), await specsOf(), [3]);
  return pageMetadata(
    `/fund/${code}/`,
    `${scheme.scheme_name}: rolling returns, risk and peers`,
    `${scheme.scheme_name}${scheme.clean_sub_category ? ` (${scheme.clean_sub_category})` : ""}. ` +
      `${rolling ?? "Trailing and rolling returns."} Risk and peer comparison from AMFI NAV ` +
      `history. Not investment advice.`,
  );
}

/** The trail and structured data every fund page carries, metrics or not. */
async function FundContext({ scheme }: { scheme: SchemeDetail["scheme"] }) {
  const category = await categoryPageFor(scheme.clean_sub_category);
  const path = `/fund/${scheme.scheme_code}/`;
  const isins = [scheme.isin_growth, scheme.isin_dividend].filter(Boolean);
  return (
    <>
      <Breadcrumbs
        trail={[
          ["Home", "/"],
          category ? [category.subCategory, categoryPath(category)] : ["Screener", "/screener/"],
          [scheme.scheme_name, path],
        ]}
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

/** A fund the source lists but nothing can be computed for. Not an error page. */
function NoMetrics({ scheme, reason }: { scheme: SchemeDetail["scheme"]; reason: string }) {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{scheme.scheme_name}</h1>
        <p className="mt-1 text-sm text-ink-500">
          {scheme.amc} · {scheme.clean_sub_category} · scheme code {scheme.scheme_code}
        </p>
      </header>
      <Card title="No metrics for this scheme">
        <p className="text-sm text-ink-700">{reason}</p>
        <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {[
            ["Status", scheme.is_active ? "Active" : "Inactive or matured"],
            [
              "NAV dates published",
              `${scheme.first_nav_date ?? "-"} to ${scheme.last_nav_date ?? "-"}`,
            ],
            ["Plan / option", `${scheme.clean_plan} / ${scheme.clean_option}`],
            ["Category", scheme.clean_category ?? "-"],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-ink-100 py-1">
              <dt className="text-ink-500">{label}</dt>
              <dd className="text-right text-ink-900">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-ink-500">
          The scheme is kept in the raw data exactly as the source publishes it. It is excluded from
          screens and peer groups because no return can be formed from it, not because it was
          filtered out by a preference.{" "}
          <Link href="/methodology" className="text-accent-600 hover:underline">
            Methodology
          </Link>
        </p>
      </Card>
    </div>
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
      <FundView detail={detail} summary={rollingSummary(metrics, specs)} />
    </div>
  );
}
