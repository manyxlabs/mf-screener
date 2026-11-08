import type { Metadata } from "next";
import { NotFoundView } from "@/components/not-found-view";
import { RootLayout, rootMetadata } from "@/components/root-layout";
import { makeI18n } from "@/lib/i18n/core";
import { SITE_NAME } from "@/lib/site";
import en from "@/messages/en";

// GitHub Pages answers every unknown URL, in any language, with this one 404.html.
const english = makeI18n("en", en);

export const metadata: Metadata = {
  ...rootMetadata(english),
  // The title template applies to a layout's children, and this page has no layout.
  title: { absolute: `${en.notFound.title} | ${SITE_NAME}` },
  robots: { index: false },
};

export default function GlobalNotFound() {
  return (
    <RootLayout i18n={english}>
      <NotFoundView />
    </RootLayout>
  );
}
