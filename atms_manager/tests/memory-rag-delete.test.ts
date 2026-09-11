import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BruteForceIndex } from "../src/rag/vector-index.js";
import {
  closeDb,
  getDb,
} from "../src/persistence/db.js";
import {
  MemoryRetriever,
  type MemoryScope,
} from "../src/rag/memory-retriever.js";
import { EmbeddingService, type Embedder } from "../src/rag/embedding-service.js";
import { chunkText } from "../src/rag/chunker.js";
import { sha256Hex } from "atms-protocol";

/**
 * Deterministic mock embedder (same semantics as rag-memory-retriever.test.ts):
 * token-overlap vectors. No model download, no network.
 */
function makeSemanticMockEmbedder(dim: number): Embedder {
  const STOP = new Set(["的", "了", "和", "是", "在", "the", "a", "an", "of", "to", "in", "is"]);
  function tokens(text: string): Set<string> {
    const out = new Set<string>();
    const cjk = text.replace(/[^\u4e00-\u9fff]/g, " ").split(/\s+/).filter(Boolean);
    for (const w of cjk) {
      for (let i = 0; i < w.length - 1; i += 1) out.add(w.slice(i, i + 2));
      if (w.length === 1) out.add(w);
    }
    for (const w of text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/)) {
      if (w.length > 2 && !STOP.has(w)) out.add(w);
    }
    return out;
  }
  return {
    modelId: "mock-semantic",
    dim,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map((text) => {
        const vec = new Float32Array(dim);
        for (const tok of tokens(text)) {
          let h = 2166136261;
          for (let i = 0; i < tok.length; i += 1) {
            h ^= tok.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
          }
          vec[h % dim] += 1;
        }
        let norm = 0;
        for (let i = 0; i < dim; i += 1) norm += vec[i] * vec[i];
        norm = Math.sqrt(norm) || 1;
        for (let i = 0; i < dim; i += 1) vec[i] /= norm;
        return vec;
      });
    },
  };
}

function withFreshHome(fn: () => Promise<void>): Promise<void> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "atms-rag-del-"));
  const prev = process.env.ATMS_HOME;
  process.env.ATMS_HOME = home;
  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      if (prev === undefined) delete process.env.ATMS_HOME;
      else process.env.ATMS_HOME = prev;
      try { closeDb(); } catch { /* ignore */ }
      fs.rmSync(home, { recursive: true, force: true });
    });
}

function enableRag(): void {
  getDb().prepare("UPDATE memory_rag_config SET enabled = 1 WHERE id = 1").run();
}

function makeRetriever(): MemoryRetriever {
  const svc = new EmbeddingService(makeSemanticMockEmbedder(384));
  return new MemoryRetriever({ embeddingService: svc, index: new BruteForceIndex(384) });
}

function count(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM memory_chunks").get() as { n: number }).n;
}

afterEach(() => {
  try { closeDb(); } catch { /* ignore */ }
});

describe("MemoryRetriever deletion API", () => {
  it("deleteMemory(session, key) removes only that session's chunks", async () => {
    await withFreshHome(async () => {
      enableRag();
      const retriever = makeRetriever();
      await retriever.ensureLoaded();
      await retriever.ingestSessionMessage({ sessionId: "sess-a", role: "user", content: "Docker bridge 网络隔离配置说明" });
      await retriever.ingestSessionMessage({ sessionId: "sess-b", role: "user", content: "Redis 缓存过期策略 TTL 与 LRU" });
      expect(count()).toBeGreaterThanOrEqual(2);

      const deleted = retriever.deleteMemory("session", "sess-a");
      expect(deleted).toBeGreaterThanOrEqual(1);
      const remaining = getDb()
        .prepare("SELECT scope_key FROM memory_chunks WHERE scope = 'session'")
        .all() as Array<{ scope_key: string }>;
      expect(remaining.every((r) => r.scope_key === "sess-b")).toBe(true);

      // The index is updated too: sess-a content no longer retrievable.
      const results = await retriever.retrieveSessionMemory({ sessionId: "sess-a", query: "Docker bridge 网络隔离" });
      expect(results).toHaveLength(0);
    });
  });

  it("deleteMemory(project, key) removes only that project's chunks", async () => {
    await withFreshHome(async () => {
      enableRag();
      const retriever = makeRetriever();
      await retriever.ensureLoaded();
      await retriever.ingestExperience({ scope: "project", scopeKey: "proj-x", content: "项目 X 的部署流程是 docker compose up" });
      await retriever.ingestExperience({ scope: "project", scopeKey: "proj-y", content: "项目 Y 的数据库是 PostgreSQL 16" });
      expect(count()).toBeGreaterThanOrEqual(2);

      const deleted = retriever.deleteMemory("project", "proj-x");
      expect(deleted).toBeGreaterThanOrEqual(1);
      const scopes = getDb()
        .prepare("SELECT scope_key FROM memory_chunks WHERE scope = 'project'")
        .all() as Array<{ scope_key: string }>;
      expect(scopes.map((r) => r.scope_key)).toEqual(["proj-y"]);
    });
  });

  it("deleteMemory(global) without key removes the whole global scope", async () => {
    await withFreshHome(async () => {
      enableRag();
      const retriever = makeRetriever();
      await retriever.ensureLoaded();
      await retriever.ingestExperience({ scope: "global", scopeKey: "*", content: "团队约定所有 PR 必须通过 CI" });
      await retriever.ingestSessionMessage({ sessionId: "sess-c", role: "user", content: "会话内容关于 Kubernetes 探针配置" });
      expect(count()).toBeGreaterThanOrEqual(2);

      const deleted = retriever.deleteMemory("global");
      expect(deleted).toBeGreaterThanOrEqual(1);
      const globals = getDb().prepare("SELECT COUNT(*) AS n FROM memory_chunks WHERE scope = 'global'").get() as { n: number };
      expect(globals.n).toBe(0);
      const sessions = getDb().prepare("SELECT COUNT(*) AS n FROM memory_chunks WHERE scope = 'session'").get() as { n: number };
      expect(sessions.n).toBeGreaterThanOrEqual(1);
    });
  });

  it("clearAllMemory removes everything (DB + index)", async () => {
    await withFreshHome(async () => {
      enableRag();
      const retriever = makeRetriever();
      await retriever.ensureLoaded();
      await retriever.ingestSessionMessage({ sessionId: "sess-d", role: "user", content: "第一条会话记忆：Nginx 反向代理配置" });
      await retriever.ingestExperience({ scope: "global", scopeKey: "*", content: "全局记忆：代码审查清单" });
      expect(count()).toBeGreaterThanOrEqual(2);

      const deleted = retriever.clearAllMemory();
      expect(deleted).toBeGreaterThanOrEqual(2);
      expect(count()).toBe(0);
      expect(retriever.indexSize).toBe(0);
      const results = await retriever.retrieveSessionMemory({ sessionId: "sess-d", query: "Nginx 反向代理" });
      expect(results).toHaveLength(0);
    });
  });

  it("deleteSessionMemory still works as before (alias of deleteMemory(session, id))", async () => {
    await withFreshHome(async () => {
      enableRag();
      const retriever = makeRetriever();
      await retriever.ensureLoaded();
      await retriever.ingestSessionMessage({ sessionId: "sess-e", role: "assistant", content: "助手回答：使用 0.0.0.0 绑定让 Docker worker 可达" });
      const before = count();
      expect(before).toBeGreaterThanOrEqual(1);
      const deleted = retriever.deleteSessionMemory("sess-e");
      expect(deleted).toBe(before);
      expect(count()).toBe(0);
    });
  });
});
