import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDockerBin } from "../docker-bin.js";
import { resolveDockerCliPath } from "../providers/docker-cli-provider.js";

const created: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "atms-node-docker-bin-"));
  created.push(dir);
  return dir;
}

function writeReinvokingWrapper(dir: string): string {
  const file = path.join(dir, "docker");
  fs.writeFileSync(
    file,
    [
      "#!/usr/bin/env node",
      'const { spawn } = require("child_process");',
      'spawn("sg", ["docker", "-c", "docker version --format {{json .}}" ]);',
      "",
    ].join("\n"),
  );
  fs.chmodSync(file, 0o755);
  return file;
}

function writeRealBinary(dir: string): string {
  const file = path.join(dir, "docker");
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64)]));
  fs.chmodSync(file, 0o755);
  return file;
}

function envWithPath(...dirs: string[]): NodeJS.ProcessEnv {
  return { PATH: dirs.join(path.delimiter) } as NodeJS.ProcessEnv;
}

afterEach(() => {
  while (created.length > 0) {
    fs.rmSync(created.pop()!, { recursive: true, force: true });
  }
});

describe("resolveDockerBin", () => {
  it("honors an explicit ATMS_DOCKER_BIN override", () => {
    expect(resolveDockerBin({ ATMS_DOCKER_BIN: "/opt/docker/bin/docker" } as NodeJS.ProcessEnv))
      .toBe("/opt/docker/bin/docker");
  });

  it("skips a PATH wrapper that re-invokes docker", () => {
    const wrapperDir = tempDir();
    const binaryDir = tempDir();
    writeReinvokingWrapper(wrapperDir);
    const binary = writeRealBinary(binaryDir);

    expect(resolveDockerBin(envWithPath(wrapperDir, binaryDir))).toBe(binary);
  });

  it("falls back to the bare name when PATH has no docker", () => {
    expect(resolveDockerBin(envWithPath(tempDir()))).toBe("docker");
  });
});

describe("resolveDockerCliPath", () => {
  it("skips a re-invoking wrapper on PATH", () => {
    const wrapperDir = tempDir();
    const binaryDir = tempDir();
    writeReinvokingWrapper(wrapperDir);
    const binary = writeRealBinary(binaryDir);

    expect(resolveDockerCliPath({
      env: envWithPath(wrapperDir, binaryDir),
      platform: "linux",
      existsSync: fs.existsSync,
    })).toBe(binary);
  });

  it("still supports an explicit dockerPath override", () => {
    expect(resolveDockerCliPath({ dockerPath: "/custom/docker" })).toBe("/custom/docker");
  });
});
