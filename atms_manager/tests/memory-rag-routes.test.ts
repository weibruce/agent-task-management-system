import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { appendMessage, createSession } from "../src/persistence/agent-sessions.js";
import { closeDb, getDb } from "../src/persistence/db.js";
import { resetRagRuntime } from "../src/rag/runtime.js";
import { memoryRagRoutesHandler } from "../src/server/memory-rag.js";

/**
 * HTTP integration test for the /api/memory/rag/* routes.
 *
 * Exercises the handler through a real http.Server (request/response objects
 * are not easily constructed by hand) with the real RAG runtime. The model is
 * cached from the benchmark run, so embedding takes seconds.
 */

function withFreshHome(fn: () => Promise<void>): Promise<void> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "atms-rag-http-"));
  const prev = process.env.ATMS_HOME;
  process.env.ATMS_HOME = home;
  resetRagRuntime();
  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      if (prev === undefined) delete process.env.ATMS_HOME;
      else process.env.ATMS_HOME = prev;
      try { closeDb(); } catch { /* ignore */ }
      resetRagRuntime();
      fs.rmSync(home, { recursive: true, force: true });
    });
}

function enableRag(): void {
  getDb().prepare(
    "UPDATE memory_rag_config SET enabled = 1, model_id = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', dim = 384 WHERE id = 1",
  ).run();
}

interface TestServer {
  url: string;
  close: () => Promise<void>;
}

function startTestServer(): Promise<TestServer> {
  const server = http.createServer((req, res) => {
    if (!memoryRagRoutesHandler(req, res)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, message: "not found" }));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

async function request(
  server: TestServer,
  method: string,
  pathname: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${server.url}${pathname}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

afterEach(() => {
  try { closeDb(); } catch { /* ignore */ }
  resetRagRuntime();
});

describe("memoryRagRoutesHandler", () => {
  it("GET /api/memory/rag/status returns config + chunk stats (no model load)", async () => {
    await withFreshHome(async () => {
      const server = await startTestServer();
      try {
        const { status, json } = await request(server, "GET", "/api/memory/rag/status");
        expect(status).toBe(200);
        expect(json.success).toBe(true);
        const data = json.data as Record<string, unknown>;
        expect(data.enabled).toBe(false);
        expect(data.model_id).toBe("Xenova/paraphrase-multilingual-MiniLM-L12-v2");
        expect(data.dim).toBe(384);
        expect(data.total_chunks).toBe(0);
        expect(data.last_ingest).toBeNull();
      } finally {
        await server.close();
      }
    });
  }, 30_000);

  it("GET /api/memory/rag/search without query → 400", async () => {
    await withFreshHome(async () => {
      const server = await startTestServer();
      try {
        const { status, json } = await request(server, "GET", "/api/memory/rag/search");
        expect(status).toBe(400);
        expect(json.success).toBe(false);
      } finally {
        await server.close();
      }
    });
  }, 30_000);

  it("POST /api/memory/rag/ingest with unknown source → 400", async () => {
    await withFreshHome(async () => {
      const server = await startTestServer();
      try {
        const { status, json } = await request(server, "POST", "/api/memory/rag/ingest", { source: "bogus" });
        expect(status).toBe(400);
        expect(json.success).toBe(false);
      } finally {
        await server.close();
      }
    });
  }, 30_000);

  it("POST /api/memory/rag/ingest with unknown session → 404", async () => {
    await withFreshHome(async () => {
      const server = await startTestServer();
      try {
        const { status, json } = await request(server, "POST", "/api/memory/rag/ingest", {
          source: "session",
          session_id: "sess-never-existed",
        });
        expect(status).toBe(404);
        expect(json.success).toBe(false);
      } finally {
        await server.close();
      }
    });
  }, 30_000);

  it("POST /api/memory/rag/clear with bad scope → 400", async () => {
    await withFreshHome(async () => {
      const server = await startTestServer();
      try {
        const { status, json } = await request(server, "POST", "/api/memory/rag/clear?scope=bogus");
        expect(status).toBe(400);
        expect(json.success).toBe(false);
      } finally {
        await server.close();
      }
    });
  }, 30_000);

  it("full flow: ingest session → search retrieves → clear removes (real model)", async () => {
    await withFreshHome(async () => {
      enableRag();
      const session = createSession("sess-http-1", {}, "proj-1");
      appendMessage(session.session_id, "user", "Redis 缓存过期策略怎么选择？TTL 与 LRU 的区别。TTL 固定过期时间，LRU 最近最少使用淘汰，按访问模式选择。Docker bridge 网络隔离配置说明与部署注意事项。", { run_id: "run-1" });

      const server = await startTestServer();
      try {
        // Ingest via HTTP (full path: session → loadMessages → retriever →
        // memory_chunks). This also covers the slow first model load.
        const ingest = await request(server, "POST", "/api/memory/rag/ingest", {
          source: "session",
          session_id: "sess-http-1",
        });
        expect(ingest.status).toBe(200);
        const ingestData = ingest.json.data as Record<string, unknown>;
        expect(ingestData.session_id).toBe("sess-http-1");
        expect(Number(ingestData.ingested)).toBeGreaterThan(0);

        // Status reflects the ingest.
        const statusRes = await request(server, "GET", "/api/memory/rag/status");
        const statusData = statusRes.json.data as Record<string, unknown>;
        expect(statusData.enabled).toBe(true);
        expect(Number(statusData.total_chunks)).toBeGreaterThan(0);
        expect(statusData.last_ingest).toBeTruthy();
        const byScope = statusData.by_scope as Record<string, number>;
        expect(byScope.session).toBeGreaterThan(0);

        // Search finds the Redis chunk for this session.
        const search = await request(
          server,
          "GET",
          `/api/memory/rag/search?query=${encodeURIComponent("Redis 过期策略")}&session_id=sess-http-1`,
        );
        expect(search.status).toBe(200);
        const searchData = search.json.data as Record<string, unknown>;
        expect(Number(searchData.count)).toBeGreaterThan(0);
        const results = searchData.results as Array<Record<string, unknown>>;
        expect(results.every((r) => r.scope === "session")).toBe(true);
        expect(results.every((r) => r.scope_key === "sess-http-1")).toBe(true);
        expect(results.some((r) => String(r.content).includes("LRU") || String(r.content).includes("TTL"))).toBe(true);

        // Clear the session scope via HTTP.
        const clear = await request(
          server,
          "POST",
          "/api/memory/rag/clear?scope=session&scope_key=sess-http-1",
        );
        expect(clear.status).toBe(200);
        const clearData = clear.json.data as Record<string, unknown>;
        expect(Number(clearData.deleted)).toBeGreaterThan(0);

        // Status shows zero; search returns empty.
        const statusAfter = await request(server, "GET", "/api/memory/rag/status");
        expect(Number((statusAfter.json.data as Record<string, unknown>).total_chunks)).toBe(0);
        const searchAfter = await request(
          server,
          "GET",
          `/api/memory/rag/search?query=${encodeURIComponent("Redis 过期策略")}&session_id=sess-http-1`,
        );
        expect(Number((searchAfter.json.data as Record<string, unknown>).count)).toBe(0);
      } finally {
        await server.close();
      }
    });
  }, 180_000);

  it("manual ingest stores a global chunk that is visible without a session context", async () => {
    await withFreshHome(async () => {
      enableRag();
      const server = await startTestServer();
      try {
        const ingest = await request(server, "POST", "/api/memory/rag/ingest", {
          source: "manual",
          content: "团队约定：所有 PR 必须通过 CI 后才能合并。",
          scope: "global",
        });
        expect(ingest.status).toBe(200);
        const ingestData = ingest.json.data as Record<string, unknown>;
        expect(Number(ingestData.ingested)).toBeGreaterThan(0);

        const search = await request(
          server,
          "GET",
          `/api/memory/rag/search?query=${encodeURIComponent("PR 合并规则")}`,
        );
        expect(search.status).toBe(200);
        const results = (search.json.data as Record<string, unknown>).results as Array<Record<string, unknown>>;
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]!.scope).toBe("global");
        expect(String(results[0]!.content).includes("CI")).toBe(true);
      } finally {
        await server.close();
      }
    });
  }, 180_000);

  it("unknown /api/memory/rag route → 404; legacy /api/memory routes are not swallowed", async () => {
    await withFreshHome(async () => {
      const server = await startTestServer();
      try {
        const unknown = await request(server, "GET", "/api/memory/rag/nope");
        expect(unknown.status).toBe(404);
        // A non-RAG /api/memory path must return false → 404 from the test server.
        const legacy = await request(server, "GET", "/api/memory/memories");
        expect(legacy.status).toBe(404);
        expect(legacy.json.success).toBe(false);
      } finally {
        await server.close();
      }
    });
  }, 30_000);
});
