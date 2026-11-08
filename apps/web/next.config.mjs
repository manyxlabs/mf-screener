import { PHASE_PRODUCTION_BUILD } from "next/constants.js";

/** @type {(phase: string) => import('next').NextConfig} */
const nextConfig = (phase) => ({
  reactStrictMode: true,
  transpilePackages: ["@mf/shared"],
  // A static site for GitHub Pages, read from public/data instead of an API. An export
  // build writes the site into distDir; `out` also keeps it clear of the `.next` a
  // running `next dev` holds open, which a build would otherwise overwrite.
  output: "export",
  distDir: phase === PHASE_PRODUCTION_BUILD ? "out" : ".next",
  // Pages serves dir/index.html for dir/ and has no rewrites, so every route is a directory.
  trailingSlash: true,
  // Page-data collection forks one full Node worker per core. On a 16-core laptop that
  // outruns available RAM and a worker gets SIGTERMed part-way, which surfaces as an
  // intermittent "Cannot find module for page" on an otherwise clean build.
  // globalNotFound: with a root layout per language, no single not-found can render
  // the 404.html Pages serves for every unknown URL.
  experimental: { cpus: 4, globalNotFound: true },
});

export default nextConfig;
