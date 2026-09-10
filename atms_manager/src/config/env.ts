import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function getAtmsHome(): string {
  const configured = process.env.ATMS_HOME || path.join(os.homedir(), ".atms");
  if (process.env.VITEST && process.env.ATMS_ALLOW_UNSAFE_TEST_HOME !== "1") {
    const temporaryRoots = [os.tmpdir(), process.env.RUNNER_TEMP]
      .filter((root): root is string => Boolean(root?.trim()));
    const isTemporary = temporaryRoots.some((root) => isWithin(configured, root));
    if (!isTemporary) {
      throw new Error(`Vitest refused non-temporary ATMS_HOME: ${configured}`);
    }
  }
  return configured;
}

export const DEFAULT_MANAGER_PORT = 19191;
export const DEFAULT_MANAGER_HOST = "127.0.0.1";

export function getPort(): number {
  return parseInt(process.env.ATMS_MANAGER_PORT || String(DEFAULT_MANAGER_PORT), 10);
}

export function getHost(): string {
  return process.env.ATMS_MANAGER_HOST?.trim() || DEFAULT_MANAGER_HOST;
}

export function getDataRoot(): string {
  return path.join(getAtmsHome(), "manager");
}

export function getDefaultWorkspacePath(): string {
  return path.join(getAtmsHome(), "workspace", "default");
}

export function ensureDefaultWorkspacePath(): string {
  const dir = getDefaultWorkspacePath();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDbPath(): string {
  return path.join(getDataRoot(), "atms.db");
}

export function getSessionStoreRoot(): string {
  return path.join(getDataRoot(), "session-store");
}

export function getLegacyManagerTsDataRoot(): string {
  return path.join(getAtmsHome(), "manager-ts");
}

export function getPythonManagerDataRoot(): string {
  return getDataRoot();
}

export function isIsolatedFromPythonManager(): boolean {
  return false;
}
