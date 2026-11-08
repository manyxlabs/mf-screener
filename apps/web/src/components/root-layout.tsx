import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
import "@fontsource-variable/noto-sans-devanagari/wght.css";
import "@fontsource-variable/noto-sans-bengali/wght.css";
import "@fontsource-variable/noto-sans-telugu/wght.css";
import "@fontsource-variable/noto-sans-tamil/wght.css";
import "@fontsource-variable/noto-sans-gujarati/wght.css";
import "@fontsource-variable/noto-sans-kannada/wght.css";
import "@fontsource-variable/noto-sans-malayalam/wght.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { MotionEffects } from "@/components/motion-effects";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { THEME_INIT_SCRIPT } from "@/components/theme-script";
import { getMetadata } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n/client";
import { LOCALE_INIT_SCRIPT } from "@/lib/i18n/locale-script";
import type { I18n } from "@/lib/i18n/core";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import "@/app/globals.css";

// Each script's font is declared for its own Unicode range only, so a browser fetches
// one only for a page that has text in that script.

// No canonical here: a layout's would be inherited by every page that forgot its own.
export const rootMetadata = ({ t }: I18n): Metadata => ({
  metadataBase: new URL(SITE_URL),
  title: { default: t.meta.title, template: `%s | ${SITE_NAME}` },
  description: t.meta.description,
  applicationName: SITE_NAME,
});

// The portfolio's: the system theme picks the browser chrome's colour, as on manishonai.in.
export const rootViewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#050506" },
  ],
};

/** The document both root layouts render: app/(en) for English, app/[lang] for the rest. */
export async function RootLayout({ i18n, children }: { i18n: I18n; children: ReactNode }) {
  const { coverage } = await getMetadata();
  return (
    <html lang={i18n.locale} suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <script
          dangerouslySetInnerHTML={{ __html: `${THEME_INIT_SCRIPT};${LOCALE_INIT_SCRIPT}` }}
        />
        <div
          aria-hidden
          className="scroll-progress fixed inset-x-0 top-0 z-[60] h-0.5 bg-accent-500 print:hidden"
        />
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 overflow-hidden print:hidden"
        >
          <div className="halo absolute -top-[30vmax] left-1/2 h-[60vmax] w-[100vmax] -translate-x-1/2" />
          <div className="bg-dots absolute inset-0" />
        </div>
        <MotionEffects />
        <I18nProvider locale={i18n.locale}>
          <SiteHeader />
          {/* A viewport tall at least, so the footer starts below the fold: figures that load
              after hydration then never push a visible footer down, which was most of the CLS.
              The top padding clears the fixed navbar. */}
          <main className="mx-auto min-h-dvh max-w-[1600px] px-4 pt-28 pb-8 sm:px-6 print:pt-0">
            {children}
          </main>
          <SiteFooter latestNav={coverage.latest_nav_date} metricsAsOf={coverage.metrics_as_of} />
        </I18nProvider>
      </body>
    </html>
  );
}
