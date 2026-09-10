import { homedir } from "node:os";
import { join } from "node:path";

export function atmsHome(): string {
  return process.env.ATMS_HOME?.trim() || join(homedir(), ".atms");
}

export function atmsPath(...segments: string[]): string {
  return join(atmsHome(), ...segments);
}
