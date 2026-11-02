import { defineConfig } from "@playwright/test";

// Builds the static site from whatever `make static-export` wrote to public/data and
// serves `out` from a plain file server, exactly as GitHub Pages will: no Next server,
// no API. The specs pick their funds from that data rather than hard-coding codes.
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results/playwright",
  timeout: 60_000,
  fullyParallel: true,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    launchOptions: { executablePath: process.env.CHROMIUM || undefined },
  },
  // BASE_URL points the specs at a server already running, such as `next dev`.
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "next build && npx -y serve@14.2.4 out -l 3000 --no-port-switching",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        // The full export renders one page per fund.
        timeout: 900_000,
      },
});
