import { homedir } from "node:os";

export function resolveAtmsHome(): string {
  const envHome = process.env["ATMS_HOME"];
  if (envHome) {
    return normalizePath(envHome);
  }
  return normalizePath(`${homedir()}/.atms`);
}

export function normalizePath(p: string): string {
  let normalized = p.replace(/\\/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export const isWindows = process.platform === "win32";
export const isMacOS = process.platform === "darwin";
export const isLinux = process.platform === "linux";
