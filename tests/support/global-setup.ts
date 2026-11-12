// TEST ONLY. Boots the local stack for integration tests: fresh database + Supabase emulator.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { EMULATOR_PORT, TEST_DATABASE_URL, appEnv } from "./env";
import { startEmulator } from "./emulator";

export default async function setup() {
  const onlyUnit = process.argv.some((a) => a.includes("tests/unit")) && !process.argv.some((a) => a.includes("tests/integration"));
  if (onlyUnit) return;
  if (!process.env.TEST_DATABASE_URL) {
    execFileSync(path.resolve("scripts/local-db.sh"), ["start"], { stdio: ["ignore", "ignore", "inherit"] });
  }
  Object.assign(process.env, appEnv());
  const emulator = await startEmulator({ port: EMULATOR_PORT, databaseUrl: TEST_DATABASE_URL, dir: ".test-tmp/storage-vitest", reset: true });
  return async () => {
    await emulator.close();
  };
}
