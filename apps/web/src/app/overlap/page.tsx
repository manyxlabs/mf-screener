import Link from "next/link";
import { Card } from "@/components/ui";
import { pageMetadata } from "@/lib/site";

export const metadata = pageMetadata(
  "/overlap/",
  "Mutual fund portfolio overlap",
  "How portfolio overlap between two mutual funds is measured, and why this site shows no overlap figure: no holdings data is published, so none is guessed.",
);

/**
 * How much of two funds' money is in the same instruments. Overlap reads holdings
 * someone imported, never anything computed from NAV, and the published site carries
 * none, so this page explains the gap rather than offering a picker that leads nowhere.
 */
export default function OverlapPage() {
  return (
    <div className="space-y-4">
      <header className="max-w-3xl space-y-2">
        <h1 className="text-xl font-semibold text-ink-900">Portfolio overlap</h1>
        <p className="text-sm text-ink-700">
          How much of two funds&rsquo; money sits in the same instruments. Two funds you hold for
          diversification can turn out to be largely the same portfolio.
        </p>
        <p className="text-xs text-ink-500">
          Overlap is the sum of the smaller weight in each shared holding, so two identical
          portfolios are 100% and two with nothing in common are 0%. Holdings are a month-old
          photograph: the fund can have traded since. This is a different measurement from the{" "}
          <Link className="underline" href="/basket">
            return correlation on the basket page
          </Link>
          , and two funds holding different stocks can still move together.
        </p>
      </header>

      <Card title="No holdings are loaded">
        <p className="max-w-3xl text-sm text-ink-700">
          This site publishes no holdings data: AMFI publishes none, and the one free third-party
          source was unreachable on every probe. So no overlap figure is shown here, rather than a
          0% that would read as two funds having nothing in common. Running the API yourself, you
          can import your own with{" "}
          <code className="rounded bg-ink-100 px-1">make holdings-import FILE=...</code> and read
          overlap from <code className="rounded bg-ink-100 px-1">GET /overlap</code> - the CSV
          contract is in the README, and nothing is written unless the whole file passes.
        </p>
      </Card>
    </div>
  );
}
