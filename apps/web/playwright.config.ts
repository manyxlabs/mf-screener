import { defineConfig } from "@playwright/test";

// Builds the static site from whatever `make static-export` wrote to public/data and
// serves `out` from a plain file server, exactly as GitHub Pages will: no Next server,
// no API. The specs pick their funds from that data rather than hard-coding codes.
// BASE_URL points the specs at a server already running (`next dev`, say) and skips the build.
const BASE_URL = process.env.BASE_URL;
// Other projects' servers share the machine, so the port is settable.
const PORT = process.env.PORT ?? "3000";

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results/playwright",
  timeout: 60_000,
  fullyParallel: true,
  use: {
    baseURL: BASE_URL ?? `http://localhost:${PORT}`,
    launchOptions: { executablePath: process.env.CHROMIUM || undefined },
  },
  webServer: BASE_URL
    ? undefined
    : {
        command: `npm run build && npx -y serve@14.2.4 out -l ${PORT} --no-port-switching`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: true,
        // The full export renders one page per fund.
        timeout: 900_000,
      },
});
