import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "atms-protocol";

import { closeDb, clearTables, getDb } from "../src/persistence/db.js";
import { EmbeddingService, type Embedder } from "../src/rag/embedding-service.js";
import { BruteForceIndex } from "../src/rag/vector-index.js";
import { MemoryRetriever, type MemoryScope } from "../src/rag/memory-retriever.js";
import { chunkText } from "../src/rag/chunker.js";

/**
 * Deterministic mock embedder with a semantic twist: vectors are derived from
 * the *set of significant tokens* in the text, so texts sharing tokens score
 * high and unrelated texts score near zero. Good enough to assert ordering.
 */
function makeSemanticMockEmbedder(dim: number): Embedder {
  let callCount = 0;
  const STOP = new Set(["的", "了", "和", "是", "在", "the", "a", "an", "of", "to", "in", "is"]);
  function tokens(text: string): Set<string> {
    const out = new Set<string>();
    // CJK bigrams
    const cjk = text.replace(/[^\u4e00-\u9fff]/g, " ").split(/\s+/).filter(Boolean);
    for (const w of cjk) {
      for (let i = 0; i < w.length - 1; i += 1) out.add(w.slice(i, i + 2));
      if (w.length === 1) out.add(w);
    }
    // ASCII words
    for (const w of text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/)) {
      if (w.length > 2 && !STOP.has(w)) out.add(w);
    }
    return out;
  }
  return {
    modelId: "mock-semantic",
    dim,
    async embed(texts: string[]): Promise<Float32Array[]> {
      callCount += 1;
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
    getCallCount: () => callCount,
  };
}

function withFreshHome<T>(fn: () => T | Promise<T>): Promise<T> | T {
  return (async () => {
    closeDb();
    const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "atms-rag-retr-"));
    const oldHome = process.env.ATMS_HOME;
    process.env.ATMS_HOME = home;
    try {
      return await fn();
    } finally {
      closeDb();
      if (oldHome === undefined) delete process.env.ATMS_HOME;
      else process.env.ATMS_HOME = oldHome;
      fs.rmSync(home, { recursive: true, force: true });
    }
  })();
}

function enableRag(): void {
  const db = getDb();
  db.prepare("UPDATE memory_rag_config SET enabled = 1 WHERE id = 1").run();
}

function seedChunk(
  id: string,
  scope: MemoryScope,
  scopeKey: string,
  content: string,
  extra?: { sessionId?: string; source?: string },
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const vec = new Float32Array(384).fill(1 / Math.sqrt(384)); // normalized placeholder
  db.prepare(`
    INSERT INTO memory_chunks (
      id, scope, scope_key, session_id, run_id, source,
      content, content_hash, embedding, dim, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, scope, scopeKey, extra?.sessionId ?? null, null, extra?.source ?? "manual",
    content, sha256Hex(content), Buffer.from(vec.buffer), vec.length,
    "{}", now, now,
  );
}

describe("MemoryRetriever", () => {
  beforeEach(() => {
    // Each test starts from a clean, enabled RAG store.
  });

  it("ingestSessionMessage stores chunks with session scope", async () => {
    await withFreshHome(async () => {
      enableRag();
      const embedder = makeSemanticMockEmbedder(384);
      const svc = new EmbeddingService(embedder);
      const retriever = new MemoryRetriever({ embeddingService: svc, index: new BruteForceIndex(384) });
      await retriever.ensureLoaded();

      const result = await retriever.ingestSessionMessage({
        sessionId: "sess-1",
        role: "user",
        content: "把订单数据同步到分析库的 ETL 管道需要每天凌晨两点运行",
      });
      expect(result.ingested).toBeGreaterThanOrEqual(1);
      expect(result.skipped).toBe(0);

      const db = getDb();
      const row = db.prepare("SELECT * FROM memory_chunks WHERE id = ?").get(result.chunkIds[0]) as Record<string, unknown>;
      expect(row.scope).toBe("session");
      expect(row.scope_key).toBe("sess-1");
      expect(row.session_id).toBe("sess-1");
      expect(row.source).toBe("session");
    });
  });

  it("retrieveSessionMemory returns the most relevant session chunks for a query", async () => {
    await withFreshHome(async () => {
      enableRag();
      const embedder = makeSemanticMockEmbedder(384);
      const svc = new EmbeddingService(embedder);
      const retriever = new MemoryRetriever({ embeddingService: svc, index: new BruteForceIndex(384) });
      await retriever.ensureLoaded();

      await retriever.ingestSessionMessage({
        sessionId: "sess-1",
        role: "user",
        content: "把订单数据同步到分析库的 ETL 管道需要每天凌晨两点运行",
      });
      await retriever.ingestSessionMessage({
        sessionId: "sess-1",
        role: "user",
        content: "今晚的天气预报说有小雨，气温最高 21 度，出门记得带伞",
      });
      await retriever.ingestSessionMessage({
        sessionId: "sess-1",
        role: "user",
        content: "证明前 n 个奇数之和等于 n 的平方，使用数学归纳法",
      });

      const results = await retriever.retrieveSessionMemory({
        sessionId: "sess-1",
        query: "ETL 数据同步管道 凌晨两点",
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].content).toContain("ETL");
      // The top hit must strictly beat at least one other retrieved chunk.
      if (results.length > 1) {
        expect(results[0].score).toBeGreaterThan(Math.min(...results.slice(1).map((r) => r.score)));
      }
    });
  });

  it("scope isolation: session chunks of other sessions are not returned", async () => {
    await withFreshHome(async () => {
      enableRag();
      const embedder = makeSemanticMockEmbedder(384);
      const svc = new EmbeddingService(embedder);
      const retriever = new MemoryRetriever({ embeddingService: svc, index: new BruteForceIndex(384) });
      await retriever.ensureLoaded();

      await retriever.ingestSessionMessage({
        sessionId: "sess-A",
        role: "user",
        content: "Docker 容器里 host.docker.internal 无法解析",
      });
      await retriever.ingestSessionMessage({
        sessionId: "sess-B",
        role: "user",
        content: "Docker 容器里 host.docker.internal 无法解析",
      });

      const results = await retriever.retrieveSessionMemory({
        sessionId: "sess-A",
        query: "Docker host.docker.internal 解析",
      });
      expect(results.length).toBe(1);
      expect(results[0].scope).toBe("session");
      expect(results[0].scopeKey).toBe("sess-A");
    });
  });

  it("min_score filters low-relevance chunks", async () => {
    await withFreshHome(async () => {
      enableRag();
      const embedder = makeSemanticMockEmbedder(384);
      const svc = new EmbeddingService(embedder);
      const retriever = new MemoryRetriever({ embeddingService: svc, index: new BruteForceIndex(384) });
      await retriever.ensureLoaded();

      await retriever.ingestSessionMessage({
        sessionId: "sess-1",
        role: "user",
        content: "咖啡冲煮的三种方式：手冲、法压、意式",
      });
      // A chunk with almost no token overlap with the query.
      await retriever.ingestSessionMessage({
        sessionId: "sess-1",
        role: "user",
        content: "数学归纳法证明等式成立的条件与步骤",
      });

      const results = await retriever.retrieveSessionMemory({
        sessionId: "sess-1",
        query: "咖啡冲煮方式对比",
        minScore: 0.3,
      });
      expect(results.length).toBe(1);
      expect(results[0].content).toContain("咖啡");
    });
  });

  it("topK limits result count", async () => {
    await withFreshHome(async () => {
      enableRag();
      const embedder = makeSemanticMockEmbedder(384);
      const svc = new EmbeddingService(embedder);
      const retriever = new MemoryRetriever({ embeddingService: svc, index: new BruteForceIndex(384) });
      await retriever.ensureLoaded();

      for (let i = 0; i < 6; i += 1) {
        await retriever.ingestSessionMessage({
          sessionId: "sess-1",
          role: "user",
          content: `关于 Docker 容器网络配置的第 ${i + 1} 条笔记 host.docker.internal 映射`,
        });
      }
      const results = await retriever.retrieveSessionMemory({
        sessionId: "sess-1",
        query: "Docker 容器网络 host.docker.internal",
        topK: 3,
      });
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  it("duplicate content is deduped by content_hash (skipped, not re-embedded)", async () => {
    await withFreshHome(async () => {
      enableRag();
      const embedder = makeSemanticMockEmbedder(384);
      const svc = new EmbeddingService(embedder);
      const retriever = new MemoryRetriever({ embeddingService: svc, index: new BruteForceIndex(384) });
      await retriever.ensureLoaded();

      const text = "完全相同的消息内容，用于验证去重逻辑";
      const first = await retriever.ingestSessionMessage({ sessionId: "sess-1", role: "user", content: text });
      const second = await retriever.ingestSessionMessage({ sessionId: "sess-1", role: "assistant", content: text });
      expect(first.ingested).toBe(1);
      expect(second.ingested).toBe(0);
      expect(second.skipped).toBe(1);

      const db = getDb();
      expect((db.prepare("SELECT COUNT(*) AS n FROM memory_chunks").get() as { n: number }).n).toBe(1);
    });
  });

  it("disabled RAG: ingest is a no-op and retrieve returns empty", async () => {
    await withFreshHome(async () => {
      // Do NOT enable RAG.
      const embedder = makeSemanticMockEmbedder(384);
      const svc = new EmbeddingService(embedder);
      const retriever = new MemoryRetriever({ embeddingService: svc, index: new BruteForceIndex(384) });
      await retriever.ensureLoaded();

      const result = await retriever.ingestSessionMessage({
        sessionId: "sess-1", role: "user", content: "anything",
      });
      expect(result.ingested).toBe(0);

      const results = await retriever.retrieveSessionMemory({
        sessionId: "sess-1", query: "anything",
      });
      expect(results).toEqual([]);
    });
  });

  it("empty/whitespace content is never ingested", async () => {
    await withFreshHome(async () => {
      enableRag();
      const embedder = makeSemanticMockEmbedder(384);
      const svc = new EmbeddingService(embedder);
      const retriever = new MemoryRetriever({ embeddingService: svc, index: new BruteForceIndex(384) });
      await retriever.ensureLoaded();

      expect((await retriever.ingestSessionMessage({ sessionId: "s", role: "user", content: "   " })).ingested).toBe(0);
      expect((await retriever.ingestSessionMessage({ sessionId: "s", role: "user", content: "" })).ingested).toBe(0);
      const db = getDb();
      expect((db.prepare("SELECT COUNT(*) AS n FROM memory_chunks").get() as { n: number }).n).toBe(0);
    });
  });

  it("ensureLoaded rebuilds the in-memory index from the database", async () => {
    await withFreshHome(async () => {
      enableRag();
      // Seed rows directly (simulating prior sessions).
      for (const id of ["c1", "c2"]) {
        seedChunk(id, "session", "sess-x", `stored content for ${id}`, { sessionId: "sess-x" });
      }
      const embedder = makeSemanticMockEmbedder(384);
      const svc = new EmbeddingService(embedder);
      const retriever = new MemoryRetriever({ embeddingService: svc, index: new BruteForceIndex(384) });
      await retriever.ensureLoaded();
      expect(retriever.indexSize).toBe(2);

      const results = await retriever.retrieveSessionMemory({
        sessionId: "sess-x", query: "stored content for c1", minScore: 0,
      });
      expect(results.length).toBe(2);
      expect(results.every((r) => r.scope === "session" && r.scopeKey === "sess-x")).toBe(true);
    });
  });

  it("maxChunks caps stored chunks (oldest dropped)", async () => {
    await withFreshHome(async () => {
      enableRag();
      const db = getDb();
      db.prepare("UPDATE memory_rag_config SET max_chunks = 3 WHERE id = 1").run();
      const embedder = makeSemanticMockEmbedder(384);
      const svc = new EmbeddingService(embedder);
      const retriever = new MemoryRetriever({ embeddingService: svc, index: new BruteForceIndex(384) });
      await retriever.ensureLoaded();

      // Ingest 6 distinct messages directly (bypassing the cap) to reach n=6,
      // then one more ingest triggers the trim down to max_chunks=3.
      for (let i = 0; i < 6; i += 1) {
        const id = `seed_${i}`;
        const now = new Date(Date.now() + i).toISOString(); // strictly increasing
        const vec = new Float32Array(384).fill(1 / Math.sqrt(384));
        db.prepare(`
          INSERT INTO memory_chunks (
            id, scope, scope_key, session_id, run_id, source,
            content, content_hash, embedding, dim, metadata, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, "session", "sess-1", "sess-1", null, "session",
          `直接播种的第 ${i + 1} 条内容 用于上限测试`, sha256Hex(`seed-content-${i}`),
          Buffer.from(vec.buffer), vec.length, "{}", now, now,
        );
      }
      expect((db.prepare("SELECT COUNT(*) AS n FROM memory_chunks").get() as { n: number }).n).toBe(6);

      // 7th ingest: cap enforcement sees n=6, overflow = 6+1-3 = 4 dropped,
      // then 1 new added → total exactly max_chunks = 3.
      await retriever.ingestSessionMessage({
        sessionId: "sess-1", role: "user", content: "第七个唯一内容 触发上限修剪逻辑",
      });
      const afterSeventh = (db.prepare("SELECT COUNT(*) AS n FROM memory_chunks").get() as { n: number }).n;
      expect(afterSeventh).toBe(3);

      // 8th ingest keeps the invariant at exactly max_chunks.
      await retriever.ingestSessionMessage({
        sessionId: "sess-1", role: "user", content: "第八个唯一内容 收敛到上限值",
      });
      const afterEighth = (db.prepare("SELECT COUNT(*) AS n FROM memory_chunks").get() as { n: number }).n;
      expect(afterEighth).toBe(3);
      // And the oldest seeded rows are gone.
      expect((db.prepare("SELECT COUNT(*) AS n FROM memory_chunks WHERE id = 'seed_0'").get() as { n: number }).n).toBe(0);
    });
  });

  it("ingestExperience stores under the given scope with experience source", async () => {
    await withFreshHome(async () => {
      enableRag();
      const embedder = makeSemanticMockEmbedder(384);
      const svc = new EmbeddingService(embedder);
      const retriever = new MemoryRetriever({ embeddingService: svc, index: new BruteForceIndex(384) });
      await retriever.ensureLoaded();

      const result = await retriever.ingestExperience({
        scope: "project",
        scopeKey: "proj-1",
        content: "经验：DAG 节点失败时应先检查 LLM 配置再重试",
        metadata: { kind: "lesson" },
      });
      expect(result.ingested).toBe(1);
      const row = getDb().prepare("SELECT * FROM memory_chunks WHERE id = ?").get(result.chunkIds[0]) as Record<string, unknown>;
      expect(row.scope).toBe("project");
      expect(row.source).toBe("experience");
    });
  });

  it("deleteSessionMemory removes a session's chunks and index entries", async () => {
    await withFreshHome(async () => {
      enableRag();
      const embedder = makeSemanticMockEmbedder(384);
      const svc = new EmbeddingService(embedder);
      const retriever = new MemoryRetriever({ embeddingService: svc, index: new BruteForceIndex(384) });
      await retriever.ensureLoaded();

      await retriever.ingestSessionMessage({ sessionId: "sess-del", role: "user", content: "要被删除的会话内容 Docker 网络" });
      expect((getDb().prepare("SELECT COUNT(*) AS n FROM memory_chunks").get() as { n: number }).n).toBe(1);

      const deleted = retriever.deleteSessionMemory("sess-del");
      expect(deleted).toBe(1);
      expect((getDb().prepare("SELECT COUNT(*) AS n FROM memory_chunks").get() as { n: number }).n).toBe(0);
      expect(retriever.indexSize).toBe(0);
    });
  });

  it("buildMemoryContext produces the injection block with provenance", async () => {
    await withFreshHome(async () => {
      enableRag();
      const embedder = makeSemanticMockEmbedder(384);
      const svc = new EmbeddingService(embedder);
      const retriever = new MemoryRetriever({ embeddingService: svc, index: new BruteForceIndex(384) });
      await retriever.ensureLoaded();

      await retriever.ingestSessionMessage({ sessionId: "sess-1", role: "user", content: "ETL 管道凌晨两点同步订单数据" });
      await retriever.ingestSessionMessage({ sessionId: "sess-1", role: "user", content: "咖啡冲煮手冲法压意式对比" });

      const block = await retriever.buildMemoryContext({
        sessionId: "sess-1",
        query: "ETL 管道同步",
      });
      expect(block).toContain("长期记忆检索结果");
      expect(block).toContain("ETL");
      expect(block).toContain("score=");
      expect(block).toContain("来源");
    });
  });
});
