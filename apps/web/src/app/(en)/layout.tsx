import { RootLayout, rootMetadata } from "@/components/root-layout";
import { getI18n } from "@/lib/i18n/server";

export { rootViewport as viewport } from "@/components/root-layout";

export const generateMetadata = async () => rootMetadata(await getI18n("en"));

export default async function EnglishLayout({ children }: { children: React.ReactNode }) {
  return <RootLayout i18n={await getI18n("en")}>{children}</RootLayout>;
}
