"use client";

import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo } from "react";

export function Formula({ tex, display = true }: { tex: string; display?: boolean }) {
  const html = useMemo(
    () => katex.renderToString(tex, { displayMode: display, throwOnError: false }),
    [tex, display],
  );
  return (
    <span
      className="block overflow-x-auto py-1"
      // KaTeX output is generated locally from a fixed string, never from user input.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
