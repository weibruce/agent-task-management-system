import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getAtmsHome } from "../src/config/env.js";

const originalHome = process.env.ATMS_HOME;
const originalRunnerTemp = process.env.RUNNER_TEMP;
const originalUnsafe = process.env.ATMS_ALLOW_UNSAFE_TEST_HOME;

afterEach(() => {
  if (originalHome === undefined) delete process.env.ATMS_HOME;
  else process.env.ATMS_HOME = originalHome;
  if (originalRunnerTemp === undefined) delete process.env.RUNNER_TEMP;
  else process.env.RUNNER_TEMP = originalRunnerTemp;
  if (originalUnsafe === undefined) delete process.env.ATMS_ALLOW_UNSAFE_TEST_HOME;
  else process.env.ATMS_ALLOW_UNSAFE_TEST_HOME = originalUnsafe;
});

describe("test Atms home isolation", () => {
  it("accepts a Atms home under the GitHub Actions runner temp root", () => {
    const runnerTemp = path.join(os.homedir(), "actions-runner-temp");
    const home = path.join(runnerTemp, "atms-ci");
    process.env.RUNNER_TEMP = runnerTemp;
    process.env.ATMS_HOME = home;
    delete process.env.ATMS_ALLOW_UNSAFE_TEST_HOME;

    expect(getAtmsHome()).toBe(home);
  });

  it("still rejects a Atms home outside every declared temporary root", () => {
    process.env.RUNNER_TEMP = path.join(os.tmpdir(), "actions-runner-temp");
    process.env.ATMS_HOME = path.join(os.homedir(), "persistent-atms-home");
    delete process.env.ATMS_ALLOW_UNSAFE_TEST_HOME;

    expect(() => getAtmsHome()).toThrow(/refused non-temporary ATMS_HOME/);
  });
});
