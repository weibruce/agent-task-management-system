import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtmsPluginManifestV1 } from "atms-protocol";

vi.mock("atms-plugin-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("atms-plugin-sdk")>();
  return {
    ...original,
    validatePluginSkill: vi.fn().mockReturnValue(undefined),
  };
});

import { loadPluginPackage } from "../src/plugins/manifest-loader.js";
import { ATMS_PLUGIN_SDK_ABI_VERSION } from "atms-plugin-sdk";

function writeMinimalPlugin(root: string, id = "com.example.abi", version = "1.0.0"): string {
  const packageRoot = path.join(root, `${id}-${version}`);
  fs.mkdirSync(path.join(packageRoot, "skills", "abi"), { recursive: true });
  fs.mkdirSync(path.join(packageRoot, "schemas"), { recursive: true });
  const manifest: AtmsPluginManifestV1 = {
    manifest_version: 1,
    id,
    version,
    name: "ABI Test",
    publisher: { id: "com.example", name: "Example" },
    license: "MIT",
    compatibility: {
      atms: { min: "0.1.0", max_exclusive: "0.2.0" },
      plugin_api: [1], ui_ir: [1], renderer_api: [1],
    },
    capabilities: [{
      id: "abi", summary: "ABI test.", intents: ["test abi"],
      modalities: ["text"], required_inputs: [], skill: "abi",
      tools: [], workflows: [], actions: [],
    }],
    skills: [{ id: "abi", path: "skills/abi/SKILL.md", description: "ABI test skill." }],
    schemas: [{ id: "abi-v1", file: "schemas/abi.v1.schema.json" }],
    kinds: [], tools: [], workflows: [], renderers: [], actions: [],
    runtime: { trust: "data_only", plugin_api: 1 },
    permissions: { required: [], optional: [] },
    state: { schema_version: 1, migrations: [] },
  };
  fs.writeFileSync(path.join(packageRoot, "atms.plugin.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(packageRoot, "skills", "abi", "SKILL.md"), [
    "---", "name: abi", "description: ABI test skill.", "---", "", "# ABI Test", "", "Test body.", "",
  ].join("\n"));
  fs.writeFileSync(path.join(packageRoot, "schemas", "abi.v1.schema.json"), JSON.stringify({
    type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false,
  }, null, 2));
  return packageRoot;
}

describe("plugin SDK ABI guard", () => {
  let tmpHome: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.ATMS_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "atms-sdk-abi-"));
    process.env.ATMS_HOME = tmpHome;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.ATMS_HOME;
    else process.env.ATMS_HOME = previousHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("exports ATMS_PLUGIN_SDK_ABI_VERSION from the SDK", () => {
    expect(ATMS_PLUGIN_SDK_ABI_VERSION).toBe(1);
  });

  it("throws a clear ABI mismatch error when validatePluginSkill returns undefined (stale dist)", () => {
    const packageRoot = writeMinimalPlugin(tmpHome);
    expect(() => loadPluginPackage(packageRoot, { source: "development" })).toThrow(
      /ABI mismatch/,
    );
    expect(() => loadPluginPackage(packageRoot, { source: "development" })).toThrow(
      /Manager expects ABI version 1/,
    );
    expect(() => loadPluginPackage(packageRoot, { source: "development" })).toThrow(
      /rebuild atms_plugin_sdk/i,
    );
  });
});
