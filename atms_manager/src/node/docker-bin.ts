/**
 * Safe resolution of the Docker CLI binary.
 *
 * Some hosts place a *wrapper script* named `docker` early on PATH — typically a
 * shim that re-runs the command through `sg docker` to pick up the `docker`
 * group. Such a wrapper resolves `docker` back to itself, so one probe forks
 * processes without bound until the host runs out of memory.
 *
 * Atms therefore prefers a real `docker` executable and only uses a
 * re-invoking wrapper when no real binary exists on PATH.
 */

import {
  accessSync,
  closeSync,
  constants,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import * as path from "node:path";

const EXPLICIT_BIN_ENV_KEYS = ["ATMS_DOCKER_BIN", "DOCKER_BIN"] as const;

/** Enough to sniff a shebang and the invocation inside a small wrapper script. */
const SNIFF_BYTES = 64 * 1024;

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const MACH_O_MAGICS = [0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcefaedfe, 0xcffaedfe];

/** Matches a `docker` command token inside a script, ignoring `docker-compose`. */
const REINVOKES_DOCKER = /(?:^|[^\w./-])docker(?![\w./-])/;

function readHead(file: string, bytes: number): Buffer | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const buffer = Buffer.alloc(bytes);
    const read = readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, read);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Best effort: a failure to close must not mask the resolved value.
      }
    }
  }
}

function isBinaryExecutable(file: string): boolean {
  const head = readHead(file, 4);
  if (!head || head.length < 4) return false;
  if (head.subarray(0, 4).equals(ELF_MAGIC)) return true;
  if (head.subarray(0, 2).toString("ascii") === "MZ") return true;
  return MACH_O_MAGICS.includes(head.readUInt32BE(0));
}

function isScriptThatReinvokesDocker(file: string): boolean {
  const head = readHead(file, SNIFF_BYTES);
  if (!head || head.length === 0) return false;
  const text = head.toString("utf8");
  if (!text.startsWith("#!")) return false;
  return REINVOKES_DOCKER.test(text);
}

function candidateExtensions(platform: NodeJS.Platform): string[] {
  return platform === "win32" ? [".exe", ".cmd", ".bat", ".ps1", ""] : [""];
}

function computeDockerBin(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  for (const key of EXPLICIT_BIN_ENV_KEYS) {
    const configured = env[key]?.trim();
    if (configured) return configured;
  }

  const pathValue = env.PATH ?? env.Path ?? "";
  let wrapperFallback: string | undefined;

  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir.trim()) continue;
    for (const extension of candidateExtensions(platform)) {
      const candidate = path.join(dir, `docker${extension}`);
      let real: string;
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(candidate, constants.X_OK);
        real = realpathSync(candidate);
      } catch {
        continue;
      }
      if (isBinaryExecutable(real)) return candidate;
      wrapperFallback ??= candidate;
      if (!isScriptThatReinvokesDocker(real)) return candidate;
    }
  }

  return wrapperFallback ?? "docker";
}

let cachedKey: string | undefined;
let cachedValue: string | undefined;

/**
 * Resolve the Docker CLI binary, honoring `ATMS_DOCKER_BIN` / `DOCKER_BIN` and
 * skipping PATH entries that would re-invoke themselves.
 */
export function resolveDockerBin(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const key = [
    env.ATMS_DOCKER_BIN ?? "",
    env.DOCKER_BIN ?? "",
    env.PATH ?? env.Path ?? "",
    platform,
  ].join("\u0000");
  if (cachedKey === key && cachedValue !== undefined) return cachedValue;
  const value = computeDockerBin(env, platform);
  cachedKey = key;
  cachedValue = value;
  return value;
}
