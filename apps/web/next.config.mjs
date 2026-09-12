/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@mf/shared"],
  // A production build overwrites the server chunks a running `next dev` holds open, and
  // the dev server then 500s every route with "Cannot find module ./vendor-chunks/...".
  // It does not recover on its own, so `make build` sends its output elsewhere.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Page-data collection forks one full Node worker per core. On a 16-core laptop that
  // outruns available RAM and a worker gets SIGTERMed part-way, which surfaces as an
  // intermittent "Cannot find module for page" on an otherwise clean build.
  experimental: { cpus: 4 },
};

export default nextConfig;
