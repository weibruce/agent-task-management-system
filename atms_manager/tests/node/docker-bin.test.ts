import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDockerBin } from "../../src/node/docker-bin.js";

const created: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "atms-docker-bin-"));
  created.push(dir);
  return dir;
}

/** A shim shaped like the real-world one: a script that runs `docker` again. */
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

/** A wrapper that shells out to something else, e.g. podman-docker. */
function writeForeignWrapper(dir: string): string {
  const file = path.join(dir, "docker");
  fs.writeFileSync(file, '#!/bin/sh\nexec podman "$@"\n');
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

  it("honors a DOCKER_BIN override", () => {
    expect(resolveDockerBin({ DOCKER_BIN: "/usr/bin/docker" } as NodeJS.ProcessEnv))
      .toBe("/usr/bin/docker");
  });

  it("skips a PATH wrapper that re-invokes docker", () => {
    const wrapperDir = tempDir();
    const binaryDir = tempDir();
    writeReinvokingWrapper(wrapperDir);
    const binary = writeRealBinary(binaryDir);

    expect(resolveDockerBin(envWithPath(wrapperDir, binaryDir))).toBe(binary);
  });

  it("uses the first real binary on PATH", () => {
    const first = tempDir();
    const second = tempDir();
    const expected = writeRealBinary(first);
    writeRealBinary(second);

    expect(resolveDockerBin(envWithPath(first, second))).toBe(expected);
  });

  it("accepts a wrapper that does not re-invoke docker", () => {
    const dir = tempDir();
    const wrapper = writeForeignWrapper(dir);

    expect(resolveDockerBin(envWithPath(dir))).toBe(wrapper);
  });

  it("falls back to the re-invoking wrapper when no real binary exists", () => {
    const dir = tempDir();
    const wrapper = writeReinvokingWrapper(dir);

    expect(resolveDockerBin(envWithPath(dir))).toBe(wrapper);
  });

  it("falls back to the bare name when PATH has no docker", () => {
    expect(resolveDockerBin(envWithPath(tempDir()))).toBe("docker");
  });
});
