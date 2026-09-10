import { resolveAtmsHome, normalizePath } from "../platform/paths.js";

function safeRelativePathSegments(value: string, label: string): string[] {
  const normalized = normalizePath(value);
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`${label} must be a relative .atms path segment`);
  }

  const segments = normalized.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error(`${label} contains an unsafe path segment`);
    }
    if (!/^[A-Za-z0-9._-]+$/.test(segment)) {
      throw new Error(`${label} contains unsupported characters`);
    }
  }
  return segments;
}

export function atmsHomePath(...segments: string[]): string {
  const base = resolveAtmsHome();
  const normalized = segments.map(normalizePath);
  return [base, ...normalized].join("/");
}

export function atmsNodeVolumePath(volumeId: string): string {
  return atmsHomePath("node", "volumes", ...safeRelativePathSegments(volumeId, "volumeId"));
}

export function atmsHomeUserPath(): string {
  return atmsHomePath("home");
}

export function atmsWorkerWorkspacePath(workspaceId: string): string {
  return atmsHomePath("workspace", ...safeRelativePathSegments(workspaceId, "workspaceId"));
}
