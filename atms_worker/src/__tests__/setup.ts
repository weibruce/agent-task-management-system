import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";

let testAtmsHome: string | null = null;

beforeAll(() => {
  if (!process.env.ATMS_HOME) {
    testAtmsHome = mkdtempSync(join(tmpdir(), "atms-worker-vitest-"));
    process.env.ATMS_HOME = testAtmsHome;
  }
});

afterAll(() => {
  if (testAtmsHome) {
    rmSync(testAtmsHome, { recursive: true, force: true });
    testAtmsHome = null;
  }
});
