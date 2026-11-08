import { RootLayout, rootMetadata } from "@/components/root-layout";
import { PREFIXED_LOCALES } from "@/lib/i18n/locales";
import { routeI18n, type LocaleParams } from "@/lib/i18n/server";

export { rootViewport as viewport } from "@/components/root-layout";

export const dynamicParams = false;

export const generateStaticParams = () => PREFIXED_LOCALES.map((lang) => ({ lang }));

export const generateMetadata = async ({ params }: LocaleParams) =>
  rootMetadata(await routeI18n(params));

export default async function LanguageLayout({
  children,
  params,
}: LocaleParams & { children: React.ReactNode }) {
  return <RootLayout i18n={await routeI18n(params)}>{children}</RootLayout>;
}
