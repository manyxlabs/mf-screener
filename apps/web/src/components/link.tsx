"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";
import { useI18n } from "@/lib/i18n/client";

/** next/link, with an internal path rewritten to the page's language. */
export default function Link({ href, ...props }: ComponentProps<typeof NextLink>) {
  const i18n = useI18n();
  return (
    <NextLink
      {...props}
      href={typeof href === "string" && href.startsWith("/") ? i18n.href(href) : href}
    />
  );
}
