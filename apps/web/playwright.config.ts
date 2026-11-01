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
    baseURL: "http://localhost:3000",
    launchOptions: { executablePath: process.env.CHROMIUM || undefined },
  },
  webServer: {
    command: "next build && npx -y serve@14.2.4 out -l 3000 --no-port-switching",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    // The full export renders one page per fund.
    timeout: 900_000,
  },
});
