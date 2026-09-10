import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateMounts, allowedMounts, workerAllowedMounts, MountPolicyError } from "../mount-policy.js";

describe("mount-policy", () => {
  const originalHome = process.env["ATMS_HOME"];

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env["ATMS_HOME"];
    } else {
      process.env["ATMS_HOME"] = originalHome;
    }
  });

  describe("validateMounts", () => {
    beforeEach(() => {
      process.env["ATMS_HOME"] = "/home/user/.atms";
    });

    it("allows mounts within .atms tree", () => {
      expect(() =>
        validateMounts([
          { host: "/home/user/.atms/node/volumes/abc", container: "/workspace" },
        ]),
      ).not.toThrow();
    });

    it("denies mounts outside .atms tree", () => {
      expect(() =>
        validateMounts([
          { host: "/etc/passwd", container: "/etc/passwd" },
        ]),
      ).toThrow(MountPolicyError);
      expect(() =>
        validateMounts([
          { host: "/etc/passwd", container: "/etc/passwd" },
        ]),
      ).toThrow(/outside .atms tree/);
    });

    it("denies system directory mounts", () => {
      expect(() =>
        validateMounts([
          { host: "/etc", container: "/etc" },
        ]),
      ).toThrow(MountPolicyError);
      expect(() =>
        validateMounts([
          { host: "/proc", container: "/proc" },
        ]),
      ).toThrow(MountPolicyError);
    });

    it("denies docker socket by default", () => {
      expect(() =>
        validateMounts([
          { host: "/var/run/docker.sock", container: "/var/run/docker.sock" },
        ]),
      ).toThrow(/Docker socket/);
    });

    it("allows docker socket when opted in", () => {
      expect(() =>
        validateMounts(
          [{ host: "/var/run/docker.sock", container: "/var/run/docker.sock" }],
          { allowDockerSocket: true },
        ),
      ).not.toThrow();
    });

    it("rejects mount if path does not start with atmsHome even if inside it partially", () => {
      process.env["ATMS_HOME"] = "/home/user/.atms";
      expect(() =>
        validateMounts([
          { host: "/home/user/.atms-other/vol", container: "/mnt" },
        ]),
      ).toThrow(MountPolicyError);
    });

    it("allows explicit project roots outside .atms without opening unrelated paths", () => {
      expect(() =>
        validateMounts(
          [{ host: "/path/to/storage/Temp", container: "/workspace/project" }],
          { allowedHostRoots: ["/path/to/storage/Temp"] },
        ),
      ).not.toThrow();
      expect(() =>
        validateMounts(
          [{ host: "/path/to/storage/Other", container: "/workspace/project" }],
          { allowedHostRoots: ["/path/to/storage/Temp"] },
        ),
      ).toThrow(MountPolicyError);
    });

    it("normalizes Windows backslashes before checking", () => {
      process.env["ATMS_HOME"] = "C:/Users/test/.atms";
      expect(() =>
        validateMounts([
          { host: "C:\\Users\\test\\.atms\\node\\volumes\\x", container: "/ws" },
        ]),
      ).not.toThrow();
    });
  });

  describe("allowedMounts", () => {
    beforeEach(() => {
      process.env["ATMS_HOME"] = "/home/user/.atms";
    });

    it("returns default workspace and home mounts for a volume ID", () => {
      const mounts = allowedMounts("vol-001");
      expect(mounts).toHaveLength(2);

      const workspace = mounts[0]!;
      expect(workspace.host).toBe("/home/user/.atms/node/volumes/vol-001");
      expect(workspace.container).toBe("/workspace");
      expect(workspace.mode).toBe("rw");

      const home = mounts[1]!;
      expect(home.host).toBe("/home/user/.atms/home");
      expect(home.container).toBe("/home/node");
      expect(home.mode).toBe("rw");
    });
  });

  describe("workerAllowedMounts", () => {
    beforeEach(() => {
      process.env["ATMS_HOME"] = "/home/user/.atms";
    });

    it("returns exactly one mount inside .atms/workspace", () => {
      const mounts = workerAllowedMounts("ws-abc");
      expect(mounts).toHaveLength(1);
      expect(mounts[0]!.host).toBe("/home/user/.atms/workspace/ws-abc");
      expect(mounts[0]!.container).toBe("/workspace");
      expect(mounts[0]!.mode).toBe("rw");
    });

    it("can make the worker workspace mount read-only", () => {
      expect(workerAllowedMounts("ws-readonly", true)).toEqual([
        {
          host: "/home/user/.atms/workspace/ws-readonly",
          container: "/workspace",
          mode: "ro",
        },
        {
          host: "/home/user/.atms/workspace/ws-readonly/.atms-runtime",
          container: "/workspace/.atms-runtime",
          mode: "rw",
        },
      ]);
    });

    it("keeps the workspace root read-only while exposing one isolated writable subtree", () => {
      expect(workerAllowedMounts(
        "run-1",
        true,
        true,
        "fixers/fix/inv_0001/item_0001",
      )).toEqual([
        {
          host: "/home/user/.atms/workspace/run-1",
          container: "/workspace",
          mode: "ro",
        },
        {
          host: "/home/user/.atms/workspace/run-1/.atms-runtime",
          container: "/workspace/.atms-runtime",
          mode: "rw",
        },
        {
          host: "/home/user/.atms/workspace/run-1/input",
          container: "/workspace/input",
          mode: "ro",
        },
        {
          host: "/home/user/.atms/workspace/run-1/fixers/fix/inv_0001/item_0001",
          container: "/workspace/fixers/fix/inv_0001/item_0001",
          mode: "rw",
        },
      ]);
    });

    it("overlays Git metadata read-only inside the isolated writable subtree", () => {
      expect(workerAllowedMounts(
        "run-1",
        true,
        true,
        "repo",
        true,
      )).toEqual([
        {
          host: "/home/user/.atms/workspace/run-1",
          container: "/workspace",
          mode: "ro",
        },
        {
          host: "/home/user/.atms/workspace/run-1/.atms-runtime",
          container: "/workspace/.atms-runtime",
          mode: "rw",
        },
        {
          host: "/home/user/.atms/workspace/run-1/input",
          container: "/workspace/input",
          mode: "ro",
        },
        {
          host: "/home/user/.atms/workspace/run-1/repo",
          container: "/workspace/repo",
          mode: "rw",
        },
        {
          host: "/home/user/.atms/workspace/run-1/repo/.git",
          container: "/workspace/repo/.git",
          mode: "ro",
        },
      ]);
    });

    it("rejects unsafe or protected writable subtrees", () => {
      expect(() => workerAllowedMounts("run-1", true, false, "../sibling"))
        .toThrow(/unsafe path segment/);
      expect(() => workerAllowedMounts("run-1", true, false, "/etc"))
        .toThrow(/relative workspace path/);
      expect(() => workerAllowedMounts("run-1", true, false, ""))
        .toThrow(/relative workspace path/);
      expect(() => workerAllowedMounts("run-1", true, false, "input"))
        .toThrow(/protected workspace mount/);
      expect(() => workerAllowedMounts("run-1", true, false, ".atms-runtime/audit"))
        .toThrow(/protected workspace mount/);
      expect(() => workerAllowedMounts("run-1", false, false, "repo"))
        .toThrow(/requires a read-only workspace root/);
      expect(() => workerAllowedMounts("run-1", true, false, undefined, true))
        .toThrow(/requires writableSubpath/);
    });

    it("supports run/node workspace IDs", () => {
      const mounts = workerAllowedMounts("run-1/node-1");
      expect(mounts).toHaveLength(1);
      expect(mounts[0]!.host).toBe("/home/user/.atms/workspace/run-1/node-1");
    });

    it("rejects workspace path traversal", () => {
      expect(() => workerAllowedMounts("../repo")).toThrow(/unsafe path segment/);
      expect(() => workerAllowedMounts("/tmp/repo")).toThrow(/relative .atms path segment/);
    });
  });

  describe("worker mount invariants", () => {
    beforeEach(() => {
      process.env["ATMS_HOME"] = "/home/user/.atms";
    });

    it("accepts workerAllowedMounts through validateMounts", () => {
      const mounts = workerAllowedMounts("ws-safe");
      expect(() => validateMounts(mounts)).not.toThrow();
    });

    it("rejects a repo-like mount manually injected alongside worker mount", () => {
      expect(() =>
        validateMounts([
          { host: "/home/user/.atms/workspace/ws-safe", container: "/workspace" },
          { host: "/workspace/repo", container: "/repo" },
        ]),
      ).toThrow(MountPolicyError);
      expect(() =>
        validateMounts([
          { host: "/home/user/.atms/workspace/ws-safe", container: "/workspace" },
          { host: "/workspace/repo", container: "/repo" },
        ]),
      ).toThrow(/outside .atms tree/);
    });
  });
});
