import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  appendMessage,
  closeSession,
  createSession,
  loadMessages,
} from "../src/persistence/agent-sessions.js";
import { closeDb, getDb } from "../src/persistence/db.js";
import { ingestSessionMessages } from "../src/rag/session-ingest.js";
import { getRagRuntime, resetRagRuntime } from "../src/rag/runtime.js";

/**
 * ingestSessionMessages integration test.
 *
 * Uses the real runtime (transformers embedder) because the contract under
 * test is the full path: session messages → loadMessages → retriever →
 * memory_chunks. The model is already cached from the benchmark run, so
 * loading takes seconds, not minutes.
 */

function withFreshHome(fn: () => Promise<void>): Promise<void> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "atms-rag-ingest-"));
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

afterEach(() => {
  try { closeDb(); } catch { /* ignore */ }
  resetRagRuntime();
});

describe("ingestSessionMessages", () => {
  it("ingests user+assistant messages into memory_chunks when RAG is enabled", async () => {
    await withFreshHome(async () => {
      enableRag();
      const session = createSession("sess-ingest-1", {}, "proj-1");
      appendMessage(session.session_id, "user", "Docker 网络隔离怎么配置？bridge 网络 host.docker.internal 映射", { run_id: "run-1" });
      appendMessage(session.session_id, "assistant", "使用 bridge 网络并设置 host.docker.internal 映射到宿主机 IP", { run_id: "run-1" });
      expect(loadMessages(session.session_id)).toHaveLength(2);

      const ingested = await ingestSessionMessages(session.session_id);
      expect(ingested).toBeGreaterThanOrEqual(1);

      const { n } = getDb().prepare("SELECT COUNT(*) AS n FROM memory_chunks WHERE session_id = ?").get("sess-ingest-1") as { n: number };
      expect(n).toBeGreaterThanOrEqual(1);

      // Chunks are redacted + chunked + embedded with the real model (dim 384).
      const rows = getDb().prepare("SELECT dim, scope, scope_key, source FROM memory_chunks WHERE session_id = ?").all("sess-ingest-1") as Array<Record<string, unknown>>;
      for (const row of rows) {
        expect(row.dim).toBe(384);
        expect(row.scope).toBe("session");
        expect(row.scope_key).toBe("sess-ingest-1");
      }
    });
  }, 120_000);

  it("is a no-op (0 ingested, no rows) when RAG is disabled", async () => {
    await withFreshHome(async () => {
      const session = createSession("sess-disabled", {}, "proj-1");
      appendMessage(session.session_id, "user", "Docker 网络隔离怎么配置？");
      const { enabled } = getDb().prepare("SELECT enabled FROM memory_rag_config WHERE id = 1").get() as { enabled: number };
      expect(enabled).toBe(0);

      const ingested = await ingestSessionMessages(session.session_id);
      expect(ingested).toBe(0);
      const { n } = getDb().prepare("SELECT COUNT(*) AS n FROM memory_chunks").get() as { n: number };
      expect(n).toBe(0);
    });
  }, 30_000);

  it("does not throw and returns partial count on failure (best-effort contract)", async () => {
    await withFreshHome(async () => {
      enableRag();
      // A session with no messages: ingestion must resolve with 0, not throw.
      createSession("sess-empty", {}, "proj-1");
      const ingested = await ingestSessionMessages("sess-empty");
      expect(ingested).toBe(0);
      // Unknown session: same contract.
      const unknown = await ingestSessionMessages("sess-never-existed");
      expect(unknown).toBe(0);
    });
  }, 30_000);

  it("closeSession + ingest flow: closing a session makes its content retrievable", async () => {
    await withFreshHome(async () => {
      enableRag();
      const session = createSession("sess-close-flow", {}, "proj-1");
      appendMessage(session.session_id, "user", "atms start 需要绑定 0.0.0.0 才能让 Docker worker 注册", { run_id: "run-9" });
      appendMessage(session.session_id, "assistant", "是的，默认 127.0.0.1 会导致 Worker failed to register。", { run_id: "run-9" });

      closeSession(session.session_id);
      await ingestSessionMessages(session.session_id);

      // A later turn in the SAME session should retrieve this memory.
      const { retriever } = await getRagRuntime();
      const results = await retriever.retrieveSessionMemory({
        sessionId: "sess-close-flow",
        projectId: "proj-1",
        query: "为什么 Docker worker 注册超时？",
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.content.includes("0.0.0.0") || r.content.includes("127.0.0.1"))).toBe(true);
    });
  }, 120_000);
});
