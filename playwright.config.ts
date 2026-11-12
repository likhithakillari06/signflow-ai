import { defineConfig, devices } from "@playwright/test";
import { APP_PORT, APP_URL, EMULATOR_URL, appEnv } from "./tests/support/env";

/**
 * End-to-end tests drive the production build in a real browser. The app talks to a real local
 * Postgres (real migration, real RLS) and to the test-only Supabase Auth/Storage emulator.
 * RESEND_API_KEY is deliberately wrong here so the "broken email configuration" path is
 * exercised through the UI; the working-email path is covered by the integration tests.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results",
  use: { baseURL: APP_URL, trace: "retain-on-failure", screenshot: "only-on-failure", acceptDownloads: true },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 } } }],
  webServer: [
    { command: "npx tsx tests/support/run-emulator.ts", url: `${EMULATOR_URL}/health`, reuseExistingServer: false, timeout: 60_000 },
    {
      command: `npx next build && npx next start -H 127.0.0.1 -p ${APP_PORT}`,
      url: `${APP_URL}/login`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: { ...appEnv({ RESEND_API_KEY: "re_wrong_key_for_e2e", NEXT_DIST_DIR: ".next-e2e" }) },
    },
  ],
});
