import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createProgram } from "../src/index.js";

function mockFetch(responseData: unknown, status = 200): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => responseData,
  } as unknown as Response);
}

let tempHome: string;
let previousHome: string | undefined;

beforeEach(() => {
  vi.restoreAllMocks();
  tempHome = mkdtempSync(join(tmpdir(), "atms-cli-memory-test-"));
  previousHome = process.env.ATMS_HOME;
  process.env.ATMS_HOME = tempHome;
  delete process.env.ATMS_MANAGER_URL;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.ATMS_HOME;
  else process.env.ATMS_HOME = previousHome;
  rmSync(tempHome, { recursive: true, force: true });
});

describe("atms memory status", () => {
  it("prints status in human-readable mode", async () => {
    mockFetch({
      success: true,
      message: "ok",
      data: {
        status: {
          enabled: true,
          model_id: "paraphrase-multilingual-MiniLM-L12-v2",
          dim: 384,
          chunk_size: 512,
          chunk_overlap: 64,
          top_k: 5,
          min_score: 0.35,
          max_chunks: 50000,
          total_chunks: 42,
          by_scope: { global: 30, session: 12, project: 0 },
          last_ingest: "2026-09-11T08:00:00.000Z",
        },
      },
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = createProgram();
    await program.parseAsync(["node", "atms", "memory", "status"]);

    const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("RAG memory: enabled");
    expect(output).toContain("paraphrase-multilingual-MiniLM-L12-v2");
    expect(output).toContain("Chunks: 42 total (limit 50000)");
    expect(output).toContain("global: 30");
    expect(output).toContain("session: 12");
    expect(output).toContain("Last ingest: 2026-09-11T08:00:00.000Z");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:19191/api/memory/rag/status",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("prints JSON with --json", async () => {
    const data = { status: { enabled: false, total_chunks: 0, by_scope: {} } };
    mockFetch({ success: true, message: "ok", data });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = createProgram();
    await program.parseAsync(["node", "atms", "--json", "memory", "status"]);
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.data.status.enabled).toBe(false);
  });
});

describe("atms memory search", () => {
  it("joins multi-word query and prints results", async () => {
    mockFetch({
      success: true,
      message: "ok",
      data: {
        query: "Redis 过期策略",
        count: 1,
        results: [
          {
            id: "c1",
            scope: "session",
            scope_key: "sess-1",
            session_id: "sess-1",
            source: "session",
            content: "TTL 是固定过期时间，LRU 是最近最少使用淘汰",
            score: 0.81,
            created_at: "2026-09-11T08:00:00.000Z",
          },
        ],
      },
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = createProgram();
    await program.parseAsync(["node", "atms", "memory", "search", "Redis", "过期策略", "--top", "3"]);

    const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("[0.810]");
    expect(output).toContain("(session sess-1, session)");
    expect(output).toContain("TTL 是固定过期时间");
    expect(String((globalThis.fetch as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toContain("/api/memory/rag/search?query=Redis");
    expect(String((globalThis.fetch as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toContain("top_k=3");
  });

  it("passes session and project filters as query params", async () => {
    mockFetch({ success: true, message: "ok", data: { query: "q", count: 0, results: [] } });
    const program = createProgram();
    await program.parseAsync([
      "node", "atms", "memory", "search", "q",
      "--session", "sess-9", "--project", "proj-9", "--min-score", "0.5",
    ]);
    const url = String((globalThis.fetch as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
    expect(url).toContain("session_id=sess-9");
    expect(url).toContain("project_id=proj-9");
    expect(url).toContain("min_score=0.5");
  });

  it("prints a hint when nothing matches", async () => {
    mockFetch({ success: true, message: "ok", data: { query: "q", count: 0, results: [] } });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = createProgram();
    await program.parseAsync(["node", "atms", "memory", "search", "q"]);
    expect(logSpy.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("No matching memories.");
  });
});

describe("atms memory ingest", () => {
  it("ingests a session by id", async () => {
    mockFetch({ success: true, message: "ok", data: { session_id: "sess-1", ingested: 3 } });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = createProgram();
    await program.parseAsync(["node", "atms", "memory", "ingest", "--session", "sess-1"]);

    expect(logSpy.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("Ingested 3 chunks from session sess-1.");
    const request = (globalThis.fetch as { mock: { calls: unknown[][] } }).mock.calls[0][1] as { body: string };
    expect(JSON.parse(request.body)).toEqual({ source: "session", session_id: "sess-1" });
    expect(String((globalThis.fetch as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toBe("http://localhost:19191/api/memory/rag/ingest");
  });

  it("ingests manual content with scope (default global)", async () => {
    mockFetch({ success: true, message: "ok", data: { ingested: 1, skipped: 0 } });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = createProgram();
    await program.parseAsync([
      "node", "atms", "memory", "ingest",
      "--text", "团队约定所有 PR 必须通过 CI", "--scope", "global",
    ]);

    const request = (globalThis.fetch as { mock: { calls: unknown[][] } }).mock.calls[0][1] as { body: string };
    expect(JSON.parse(request.body)).toEqual({
      source: "manual",
      content: "团队约定所有 PR 必须通过 CI",
      scope: "global",
      scope_key: undefined,
    });
    expect(logSpy.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("Ingested 1 chunk(s)");
  });
});

describe("atms memory clear", () => {
  it("clears a single session", async () => {
    mockFetch({ success: true, message: "ok", data: { deleted: 2 } });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = createProgram();
    await program.parseAsync(["node", "atms", "memory", "clear", "--session", "sess-1"]);

    const url = String((globalThis.fetch as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
    expect(url).toContain("/api/memory/rag/clear?scope=session&scope_key=sess-1");
    expect(logSpy.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("Deleted 2 chunk(s).");
  });

  it("clears a whole scope", async () => {
    mockFetch({ success: true, message: "ok", data: { deleted: 10 } });
    const program = createProgram();
    await program.parseAsync(["node", "atms", "memory", "clear", "--scope", "project"]);
    const url = String((globalThis.fetch as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
    expect(url).toContain("scope=project");
    expect(url).not.toContain("scope_key");
  });

  it("clears everything with --all", async () => {
    mockFetch({ success: true, message: "ok", data: { deleted: 99 } });
    const program = createProgram();
    await program.parseAsync(["node", "atms", "memory", "clear", "--all"]);
    const url = String((globalThis.fetch as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
    expect(url).toContain("scope=all");
  });

  it("rejects clearing with no scope flag", async () => {
    mockFetch({ success: true, message: "ok", data: { deleted: 0 } });
    const program = createProgram();
    await expect(program.parseAsync(["node", "atms", "memory", "clear"])).rejects.toThrow(
      "Specify one of",
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
