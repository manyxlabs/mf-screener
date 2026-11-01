import type { SchemeDetail } from "@mf/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { ApiError, getScheme } from "@/lib/api";
import { exportedFundCodes } from "@/lib/static-data.server";
import { FundView } from "./fund-view";

type Params = { params: Promise<{ scheme_code: string }> };

export const dynamicParams = false;

export const generateStaticParams = async () =>
  (await exportedFundCodes()).map((scheme_code) => ({ scheme_code }));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { scheme } = await getScheme((await params).scheme_code);
  const about = [scheme.amc, scheme.clean_sub_category].filter(Boolean).join(", ");
  return {
    title: `${scheme.scheme_name}: returns, risk and peers`,
    description:
      `Trailing and rolling returns, risk metrics and peer comparison for ${scheme.scheme_name}` +
      `${about ? ` (${about})` : ""}, computed from AMFI NAV history. Not investment advice.`,
  };
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
    return <NoMetrics scheme={detail.scheme} reason={detail.metrics_unavailable.description} />;
  }
  return <FundView detail={detail} />;
}
