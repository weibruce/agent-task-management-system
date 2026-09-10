import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

const FORBIDDEN_PATTERNS = [
  /192\.168\.100/,
  /:8999/,
  /AGENTS\.md/,
  /CLAUDE\.md/,
  /\/home\/matrix/,
  /scripts\/atms\.sh/,
  new RegExp("omni_" + "manager"),
  /uv run/,
];

const FORBIDDEN_COMMAND_EXAMPLES = [
  /atms templates --base-url/,
  /atms templates\s*$/m,
  /atms templates --json/,
  /atms run\s+\S+\s+"[^"]+"/,
  /atms status <run_id> --json/,
  /atms provider\s*$/m,
  /atms llm-settings\s*$/m,
  /atms evidence <subcommand>/,
];

const SKILL_FILES = [
  resolve(repoRoot, "skills/atms-cli/SKILL.md"),
  resolve(repoRoot, "skills/atms-dag-ops/SKILL.md"),
];

describe("public skill files must not contain internal hostnames or references", () => {
  for (const filePath of SKILL_FILES) {
    const relative = filePath.replace(repoRoot + "/", "");
    it(`${relative} contains no forbidden patterns`, () => {
      const content = readFileSync(filePath, "utf-8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(
          content,
          `${relative} must not match forbidden pattern ${pattern}`,
        ).not.toMatch(pattern);
      }
    });

    it(`${relative} contains current TS CLI command shapes`, () => {
      const content = readFileSync(filePath, "utf-8");
      for (const pattern of FORBIDDEN_COMMAND_EXAMPLES) {
        expect(
          content,
          `${relative} must not contain stale command example ${pattern}`,
        ).not.toMatch(pattern);
      }
    });
  }
});
