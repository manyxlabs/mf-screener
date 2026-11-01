import { defineConfig } from "@playwright/test";

// Runs against whatever store `make data-sample` or `make data-build` produced, so the
// specs pick their funds from the live data rather than hard-coding scheme codes.
// The web server serves the production build: run `make build` first (`make e2e` does).
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results/playwright",
  timeout: 60_000,
  fullyParallel: true,
  use: {
    baseURL: "http://localhost:3000",
    launchOptions: { executablePath: process.env.CHROMIUM || undefined },
  },
  webServer: [
    {
      command: "uv run uvicorn mf_api.main:app --host 127.0.0.1 --port 8000",
      cwd: "../..",
      url: "http://127.0.0.1:8000/health",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "next start -p 3000",
      env: { NEXT_DIST_DIR: ".next-build" },
      url: "http://localhost:3000",
      reuseExistingServer: true,
    },
  ],
});
