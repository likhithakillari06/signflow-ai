// TEST ONLY. Resets the local test database, then starts the Supabase emulator (used by Playwright).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { EMULATOR_PORT, TEST_DATABASE_URL } from "./env";
import { startEmulator } from "./emulator";

if (!process.env.TEST_DATABASE_URL) {
  execFileSync(path.resolve("scripts/local-db.sh"), ["start"], { stdio: ["ignore", "ignore", "inherit"] });
}
startEmulator({ port: EMULATOR_PORT, databaseUrl: TEST_DATABASE_URL, dir: ".test-tmp/storage-e2e", reset: true }).then(() => {
  console.log(`Supabase emulator listening on http://127.0.0.1:${EMULATOR_PORT}`);
});
