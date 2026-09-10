import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AtmsPluginConfirmation,
  AtmsPluginEffect,
  AtmsPluginPermission,
} from "atms-protocol";
import { buildHrpArchive, scaffoldPluginProject, scanPluginSource, sourceFilesForPack } from "atms-plugin-sdk";
import { closeDb, getDb } from "../src/persistence/db.js";
import { setPluginGrantStatus } from "../src/persistence/plugins.js";
import { installHrpArchive } from "../src/plugins/package-lifecycle.js";
import { resolvePluginPermissionPolicy } from "../src/plugins/permission-broker.js";

describe("plugin permission broker", () => {
  let previousHome: string | undefined;
  let home: string;
  let source: string;

  beforeEach(() => {
    closeDb();
    previousHome = process.env.ATMS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "atms-permission-home-"));
    source = fs.mkdtempSync(path.join(os.tmpdir(), "atms-permission-source-"));
    process.env.ATMS_HOME = home;
    scaffoldPluginProject(source, "com.example.permissions");
    const manifestFile = path.join(source, "atms.plugin.json");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as {
      permissions: { required: unknown[]; optional: Array<Record<string, unknown>> };
    };
    manifest.permissions.optional = [
      { permission: AtmsPluginPermission.ARTIFACT_WRITE },
      {
        permission: AtmsPluginPermission.NETWORK_CONNECT,
        hosts: ["z.example.com", "api.example.com"],
      },
    ];
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    installHrpArchive(buildHrpArchive(sourceFilesForPack(scanPluginSource(source))).archive);
  });

  afterEach(() => {
    closeDb();
    if (previousHome === undefined) delete process.env.ATMS_HOME;
    else process.env.ATMS_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  });

  it("reports missing grants and binds a granted policy to the global revision", () => {
    const pending = resolvePluginPermissionPolicy({
      plugin_id: "com.example.permissions",
      plugin_version: "0.1.0",
      permissions: [AtmsPluginPermission.ARTIFACT_WRITE],
      effect: AtmsPluginEffect.WRITE,
      confirmation: AtmsPluginConfirmation.POLICY,
    });
    expect(pending).toMatchObject({
      permission_revision: 2,
      confirmation_required: true,
      runnable: false,
      missing_permissions: [AtmsPluginPermission.ARTIFACT_WRITE],
      denied_permissions: [],
      effective_grants: [{ permission: AtmsPluginPermission.ARTIFACT_WRITE }],
    });

    setPluginGrantStatus({
      plugin_id: "com.example.permissions",
      plugin_version: "0.1.0",
      permission: AtmsPluginPermission.ARTIFACT_WRITE,
      status: "granted",
      expected_revision: 1,
    });
    const granted = resolvePluginPermissionPolicy({
      plugin_id: "com.example.permissions",
      plugin_version: "0.1.0",
      permissions: [AtmsPluginPermission.ARTIFACT_WRITE],
      effect: AtmsPluginEffect.WRITE,
      confirmation: AtmsPluginConfirmation.POLICY,
    });
    expect(granted).toMatchObject({
      permission_revision: 3,
      confirmation_required: true,
      runnable: true,
      missing_permissions: [],
      denied_permissions: [],
      grants: [expect.objectContaining({ status: "granted", revision: 2 })],
    });
    expect(granted.policy_digest).not.toBe(pending.policy_digest);

    const scoped = resolvePluginPermissionPolicy({
      plugin_id: "com.example.permissions",
      plugin_version: "0.1.0",
      permissions: [AtmsPluginPermission.NETWORK_CONNECT],
      effect: AtmsPluginEffect.EXTERNAL,
      confirmation: AtmsPluginConfirmation.ALWAYS,
    });
    expect(scoped.effective_grants).toEqual([{
      permission: AtmsPluginPermission.NETWORK_CONNECT,
      hosts: ["api.example.com", "z.example.com"],
    }]);

    getDb().prepare(`
      UPDATE plugin_permission_grants SET grant_json = ?
      WHERE plugin_id = ? AND plugin_version = ? AND permission = ?
    `).run(JSON.stringify({
      required: false,
      grant: { permission: AtmsPluginPermission.NETWORK_CONNECT, hosts: ["evil.example"] },
    }), "com.example.permissions", "0.1.0", AtmsPluginPermission.NETWORK_CONNECT);
    expect(() => resolvePluginPermissionPolicy({
      plugin_id: "com.example.permissions",
      plugin_version: "0.1.0",
      permissions: [AtmsPluginPermission.NETWORK_CONNECT],
      effect: AtmsPluginEffect.EXTERNAL,
      confirmation: AtmsPluginConfirmation.ALWAYS,
    })).toThrow(/does not match the immutable package/);
  });

  it("fails closed for undeclared or duplicate permission requirements", () => {
    expect(() => resolvePluginPermissionPolicy({
      plugin_id: "com.example.permissions",
      plugin_version: "0.1.0",
      permissions: [AtmsPluginPermission.SECRET_USE],
      effect: AtmsPluginEffect.EXTERNAL,
      confirmation: AtmsPluginConfirmation.ALWAYS,
    })).toThrow(/not declared/);
    expect(() => resolvePluginPermissionPolicy({
      plugin_id: "com.example.permissions",
      plugin_version: "0.1.0",
      permissions: [AtmsPluginPermission.ARTIFACT_WRITE, AtmsPluginPermission.ARTIFACT_WRITE],
      effect: AtmsPluginEffect.WRITE,
      confirmation: AtmsPluginConfirmation.POLICY,
    })).toThrow(/unique/);
  });
});
