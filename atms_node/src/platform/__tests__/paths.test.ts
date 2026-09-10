import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveAtmsHome, normalizePath, isWindows, isMacOS, isLinux } from "../paths.js";

describe("paths", () => {
  describe("normalizePath", () => {
    it("converts backslashes to forward slashes", () => {
      expect(normalizePath("C:\\Users\\test")).toBe("C:/Users/test");
    });

    it("strips trailing slash", () => {
      expect(normalizePath("/home/user/")).toBe("/home/user");
    });

    it("does not strip root slash", () => {
      expect(normalizePath("/")).toBe("/");
    });

    it("leaves already-normalized paths unchanged", () => {
      expect(normalizePath("/home/user/project")).toBe("/home/user/project");
    });
  });

  describe("resolveAtmsHome", () => {
    const originalHome = process.env["ATMS_HOME"];

    afterEach(() => {
      if (originalHome === undefined) {
        delete process.env["ATMS_HOME"];
      } else {
        process.env["ATMS_HOME"] = originalHome;
      }
    });

    it("uses ATMS_HOME env var when set", () => {
      process.env["ATMS_HOME"] = "/custom/atms/home";
      expect(resolveAtmsHome()).toBe("/custom/atms/home");
    });

    it("defaults to ~/.atms when ATMS_HOME is unset", () => {
      delete process.env["ATMS_HOME"];
      const result = resolveAtmsHome();
      expect(result).toMatch(/\.atms$/);
    });

    it("normalizes Windows ATMS_HOME value", () => {
      process.env["ATMS_HOME"] = "C:\\Users\\test\\.atms";
      expect(resolveAtmsHome()).toBe("C:/Users/test/.atms");
    });
  });

  describe("platform detection", () => {
    it("exactly one platform flag is true", () => {
      const count = [isWindows, isMacOS, isLinux].filter(Boolean).length;
      expect(count).toBe(1);
    });

    it("matches process.platform", () => {
      if (process.platform === "win32") expect(isWindows).toBe(true);
      if (process.platform === "darwin") expect(isMacOS).toBe(true);
      if (process.platform === "linux") expect(isLinux).toBe(true);
    });
  });

  describe("cross-platform path translation", () => {
    it("normalizes Windows drive letter paths", () => {
      expect(normalizePath("C:\\Program Files\\App")).toBe("C:/Program Files/App");
      expect(normalizePath("D:\\data\\volumes")).toBe("D:/data/volumes");
    });

    it("normalizes mixed Windows forward/backslash paths", () => {
      expect(normalizePath("C:\\Users/test\\project")).toBe("C:/Users/test/project");
    });

    it("handles macOS home directory paths", () => {
      expect(normalizePath("/Users/janedoe/.atms/")).toBe("/Users/janedoe/.atms");
    });

    it("handles WSL2 /mnt paths", () => {
      expect(normalizePath("/mnt/c/Users/test/.atms")).toBe("/mnt/c/Users/test/.atms");
    });

    it("handles UNC paths by converting backslashes", () => {
      expect(normalizePath("\\\\server\\share\\path")).toBe("//server/share/path");
    });
  });
});
