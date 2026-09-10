import { resolveAtmsHome } from "../platform/paths.js";
import { atmsWorkerWorkspacePath } from "./atms-home.js";

const DENIED_PATHS = ["/etc", "/proc", "/sys", "/dev"];

export interface MountPolicyOptions {
  allowDockerSocket?: boolean;
  allowedHostRoots?: string[];
}

export interface MountEntry {
  host: string;
  container: string;
  mode?: string;
}

export class MountPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MountPolicyError";
  }
}

export function validateMounts(
  mounts: MountEntry[],
  options: MountPolicyOptions = {},
): void {
  const atmsHome = resolveAtmsHome();
  const allowedHostRoots = (options.allowedHostRoots ?? [])
    .map((root) => root.replace(/\\/g, "/").replace(/\/+$/, ""))
    .filter((root) => root && root !== "/" && !DENIED_PATHS.some((denied) => root === denied || root.startsWith(`${denied}/`)));

  for (const mount of mounts) {
    const host = mount.host.replace(/\\/g, "/");

    if (DENIED_PATHS.includes(host)) {
      throw new MountPolicyError(
        `Mount denied: "${host}" is a protected system directory`,
      );
    }

    if (host === "/var/run/docker.sock") {
      if (options.allowDockerSocket) {
        continue;
      }
      throw new MountPolicyError(
        `Mount denied: Docker socket mount requires allowDockerSocket: true`,
      );
    }

    const insideAtmsHome = host === atmsHome || host.startsWith(atmsHome + "/");
    const insideAllowedRoot = allowedHostRoots.some((root) => host === root || host.startsWith(root + "/"));
    if (!insideAtmsHome && !insideAllowedRoot) {
      throw new MountPolicyError(
        `Mount denied: "${mount.host}" is outside .atms tree (${atmsHome})`,
      );
    }
  }
}

export function allowedMounts(volumeId: string): MountEntry[] {
  const atmsHome = resolveAtmsHome();
  return [
    {
      host: `${atmsHome}/node/volumes/${volumeId}`,
      container: "/workspace",
      mode: "rw",
    },
    {
      host: `${atmsHome}/home`,
      container: "/home/node",
      mode: "rw",
    },
  ];
}

function safeWorkerWritableSubpath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error("writableSubpath must be a non-empty relative workspace path");
  }
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error("writableSubpath contains an unsafe path segment");
    }
    if (!/^[A-Za-z0-9._-]+$/.test(segment)) {
      throw new Error("writableSubpath contains unsupported characters");
    }
  }
  return segments.join("/");
}

export function workerAllowedMounts(
  workspaceId: string,
  readOnly = false,
  readOnlyInputs = false,
  writableSubpath?: string,
  gitMetadataReadOnly = false,
): MountEntry[] {
  if (writableSubpath !== undefined && !readOnly) {
    throw new Error("writableSubpath requires a read-only workspace root");
  }
  if (gitMetadataReadOnly && writableSubpath === undefined) {
    throw new Error("read-only Git metadata requires writableSubpath");
  }
  const normalizedWritableSubpath = writableSubpath === undefined
    ? undefined
    : safeWorkerWritableSubpath(writableSubpath);
  if (
    normalizedWritableSubpath === "input"
    || normalizedWritableSubpath?.startsWith("input/")
    || normalizedWritableSubpath === ".atms-runtime"
    || normalizedWritableSubpath?.startsWith(".atms-runtime/")
  ) {
    throw new Error("writableSubpath conflicts with a protected workspace mount");
  }
  const mounts: MountEntry[] = [
    {
      host: atmsWorkerWorkspacePath(workspaceId),
      container: "/workspace",
      mode: readOnly ? "ro" : "rw",
    },
  ];
  if (readOnly) {
    mounts.push({
      host: `${atmsWorkerWorkspacePath(workspaceId)}/.atms-runtime`,
      container: "/workspace/.atms-runtime",
      mode: "rw",
    });
  }
  if (readOnlyInputs) {
    mounts.push({
      host: `${atmsWorkerWorkspacePath(workspaceId)}/input`,
      container: "/workspace/input",
      mode: "ro",
    });
  }
  if (normalizedWritableSubpath) {
    mounts.push({
      host: atmsWorkerWorkspacePath(`${workspaceId}/${normalizedWritableSubpath}`),
      container: `/workspace/${normalizedWritableSubpath}`,
      mode: "rw",
    });
    if (gitMetadataReadOnly) {
      mounts.push({
        host: `${atmsWorkerWorkspacePath(`${workspaceId}/${normalizedWritableSubpath}`)}/.git`,
        container: `/workspace/${normalizedWritableSubpath}/.git`,
        mode: "ro",
      });
    }
  }
  return mounts;
}
