import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDeepSeekHarnessReadTools,
  supportsDeepSeekHarnessReadTools,
} from "../agent/deepseek-harness-read-tools.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const workspace = mkdtempSync(join(tmpdir(), "atms-dsh-write-tools-"));
  roots.push(workspace);
  mkdirSync(join(workspace, "repository", "src"), { recursive: true });
  mkdirSync(join(workspace, "generated"), { recursive: true });
  mkdirSync(join(workspace, "outside"), { recursive: true });
  writeFileSync(join(workspace, "repository", "src", "alpha.ts"), "export const alpha = true;\nsecond line\n");
  writeFileSync(join(workspace, "repository", "README.md"), "alpha docs\n");
  writeFileSync(join(workspace, "outside", "secret.txt"), "do not read\n");
  return workspace;
}

function writeTools(workspace: string, maxCalls?: number) {
  return new Map(createDeepSeekHarnessReadTools({
    workspace,
    workspaceAccess: { writable_paths: ["generated"], readonly_paths: ["repository"] },
    allowedTools: ["Read", "Write"],
    maxCalls,
  }).map((tool) => [tool.name, tool]));
}

describe("DeepSeek Harness Write tool", () => {
  it("supportsDeepSeekHarnessReadTools accepts Write alongside read tools", () => {
    expect(supportsDeepSeekHarnessReadTools(["Read", "Write"])).toBe(true);
    expect(supportsDeepSeekHarnessReadTools(["Read", "Grep", "Glob", "LS", "Write"])).toBe(true);
    // Still rejects tools that are neither read nor write
    expect(supportsDeepSeekHarnessReadTools(["Bash"])).toBe(false);
    expect(supportsDeepSeekHarnessReadTools(["Edit"])).toBe(false);
    expect(supportsDeepSeekHarnessReadTools(["MultiEdit"])).toBe(false);
  });

  it("writes a file inside a declared writable path", async () => {
    const workspace = fixture();
    const available = writeTools(workspace);

    const res = await available.get("Write")!.handler({
      file_path: "generated/report.txt",
      content: "line 1\nline 2\n",
    });
    expect(res).toMatchObject({ content: [{ text: expect.stringContaining("generated/report.txt") }] });
    expect(res.is_error).toBeFalsy();

    const onDisk = readFileSync(join(workspace, "generated", "report.txt"), "utf8");
    expect(onDisk).toBe("line 1\nline 2\n");
  });

  it("creates parent directories for new files inside writable paths", async () => {
    const workspace = fixture();
    const available = writeTools(workspace);

    const res = await available.get("Write")!.handler({
      file_path: "generated/sub/dir/nested.txt",
      content: "nested\n",
    });
    expect(res.is_error).toBeFalsy();
    expect(readFileSync(join(workspace, "generated", "sub", "dir", "nested.txt"), "utf8")).toBe("nested\n");
  });

  it("overwrites an existing file inside a writable path", async () => {
    const workspace = fixture();
    writeFileSync(join(workspace, "generated", "existing.txt"), "old content\n");
    const available = writeTools(workspace);

    const res = await available.get("Write")!.handler({
      file_path: "generated/existing.txt",
      content: "new content\n",
    });
    expect(res.is_error).toBeFalsy();
    expect(readFileSync(join(workspace, "generated", "existing.txt"), "utf8")).toBe("new content\n");
  });

  it("rejects writes outside writable_paths (readonly path)", async () => {
    const workspace = fixture();
    const available = writeTools(workspace);

    const res = await available.get("Write")!.handler({
      file_path: "repository/README.md",
      content: "hacked\n",
    });
    expect(res).toMatchObject({ is_error: true });
    expect(res.content![0]).toMatchObject({ text: expect.stringMatching(/read-only|outside|writable/i) });
    // Original file untouched
    expect(readFileSync(join(workspace, "repository", "README.md"), "utf8")).toBe("alpha docs\n");
  });

  it("rejects writes outside the workspace entirely", async () => {
    const workspace = fixture();
    const available = writeTools(workspace);

    const res = await available.get("Write")!.handler({
      file_path: "outside/evil.txt",
      content: "bad\n",
    });
    expect(res).toMatchObject({ is_error: true });
    expect(existsSync(join(workspace, "outside", "evil.txt"))).toBe(false);
  });

  it("rejects path traversal in write targets", async () => {
    const workspace = fixture();
    const available = writeTools(workspace);

    const res = await available.get("Write")!.handler({
      file_path: "generated/../../outside/evil.txt",
      content: "bad\n",
    });
    expect(res).toMatchObject({ is_error: true });
    expect(existsSync(join(workspace, "outside", "evil.txt"))).toBe(false);
  });

  it("rejects absolute paths in write targets", async () => {
    const workspace = fixture();
    const available = writeTools(workspace);

    const res = await available.get("Write")!.handler({
      file_path: "/etc/passwd",
      content: "bad\n",
    });
    expect(res).toMatchObject({ is_error: true });
  });

  it("rejects writes when no writable_paths are declared", async () => {
    const workspace = fixture();
    const available = new Map(createDeepSeekHarnessReadTools({
      workspace,
      workspaceAccess: { writable_paths: [], readonly_paths: ["repository"] },
      allowedTools: ["Write"],
    }).map((tool) => [tool.name, tool]));

    const res = await available.get("Write")!.handler({
      file_path: "generated/nowrite.txt",
      content: "bad\n",
    });
    expect(res).toMatchObject({ is_error: true });
    expect(res.content![0]).toMatchObject({ text: expect.stringMatching(/writable|no writable|read-only/i) });
  });

  it("rejects writes via symlink escapes to outside the workspace", async () => {
    const workspace = fixture();
    symlinkSync(join(workspace, "outside"), join(workspace, "generated", "link"), "dir");
    const available = writeTools(workspace);

    const res = await available.get("Write")!.handler({
      file_path: "generated/link/escaped.txt",
      content: "bad\n",
    });
    expect(res).toMatchObject({ is_error: true });
    expect(existsSync(join(workspace, "outside", "escaped.txt"))).toBe(false);
  });

  it("enforces call budget on Write", async () => {
    const workspace = fixture();
    const available = writeTools(workspace, 1);

    await available.get("Write")!.handler({ file_path: "generated/first.txt", content: "a\n" });
    const res = await available.get("Write")!.handler({ file_path: "generated/second.txt", content: "b\n" });
    expect(res).toMatchObject({
      is_error: true,
      content: [{ text: expect.stringContaining("budget exhausted (1/1)") }],
    });
  });

  it("rejects oversized content", async () => {
    const workspace = fixture();
    const available = writeTools(workspace);

    const res = await available.get("Write")!.handler({
      file_path: "generated/huge.txt",
      content: "x".repeat(2 * 1024 * 1024 + 1),
    });
    expect(res).toMatchObject({ is_error: true });
    expect(existsSync(join(workspace, "generated", "huge.txt"))).toBe(false);
  });

  it("Write schema requires file_path and content", () => {
    const workspace = fixture();
    const available = writeTools(workspace);
    const schema = available.get("Write")!.input_schema as any;
    expect(schema.required).toEqual(expect.arrayContaining(["file_path", "content"]));
    expect(schema.type).toBe("object");
  });

  it("Read and Write can coexist in the same tool set", async () => {
    const workspace = fixture();
    const available = new Map(createDeepSeekHarnessReadTools({
      workspace,
      workspaceAccess: { writable_paths: ["generated"], readonly_paths: ["repository"] },
      allowedTools: ["Read", "Write"],
    }).map((tool) => [tool.name, tool]));

    // Write a file
    await available.get("Write")!.handler({ file_path: "generated/out.txt", content: "written\n" });
    // Read it back
    const res = await available.get("Read")!.handler({ file_path: "generated/out.txt" });
    expect(res).toMatchObject({ content: [{ text: expect.stringContaining("written") }] });
  });
});
