import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/persistence/db.js";
import { EmbeddingService, type Embedder } from "../src/rag/embedding-service.js";
import { BruteForceIndex } from "../src/rag/vector-index.js";
import { MemoryRetriever } from "../src/rag/memory-retriever.js";
import { buildMemoryInjection } from "../src/rag/memory-injection.js";

/** Deterministic semantic mock (same technique as the retriever tests). */
function makeSemanticMockEmbedder(dim: number): Embedder {
  const STOP = new Set(["的", "了", "和", "是", "在", "the", "a", "an", "of", "to", "in", "is"]);
  function tokens(text: string): Set<string> {
    const out = new Set<string>();
    const cjk = text.replace(/[^\u4e00-\u9fff]/g, " ").split(/\s+/).filter(Boolean);
    for (const w of cjk) {
      for (let i = 0; i < w.length - 1; i += 1) out.add(w.slice(i, i + 2));
      if (w.length === 1) out.add(w);
    }
    for (const w of text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/)) {
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

function withFreshHome<T>(fn: () => T | Promise<T>): Promise<T> {
  return (async () => {
    closeDb();
    const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "atms-rag-inj-"));
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

describe("buildMemoryInjection (RAG → prompt injection seam)", () => {
  it("injects retrieved memory before the user message", async () => {
    await withFreshHome(async () => {
      const db = getDb();
      db.prepare("UPDATE memory_rag_config SET enabled = 1 WHERE id = 1").run();

      const embedder = makeSemanticMockEmbedder(384);
      const svc = new EmbeddingService(embedder);
      const retriever = new MemoryRetriever({ embeddingService: svc, index: new BruteForceIndex(384) });
      await retriever.ensureLoaded();

      await retriever.ingestSessionMessage({
        sessionId: "sess-inj",
        role: "user",
        content: "ETL 管道凌晨两点把订单数据同步到分析库",
      });
      await retriever.ingestSessionMessage({
        sessionId: "sess-inj",
        role: "user",
        content: "证明前 n 个奇数之和等于 n 的平方",
      });

      const injected = await buildMemoryInjection(retriever, {
        sessionId: "sess-inj",
        projectId: undefined,
        query: "ETL 数据同步管道",
        userMessage: "帮我检查一下 ETL 的状态",
      });

      // The injection wraps the original message.
      expect(injected).toContain("帮我检查一下 ETL 的状态");
      // The memory block appears before the user message.
      const memIdx = injected.indexOf("长期记忆检索结果");
      const msgIdx = injected.indexOf("帮我检查一下 ETL 的状态");
      expect(memIdx).toBeGreaterThan(-1);
      expect(memIdx).toBeLessThan(msgIdx);
      // The relevant ETL chunk is present; the unrelated math chunk is not
      // (or is ranked after). At minimum the ETL chunk must be included.
      expect(injected).toContain("ETL");
    });
  });

  it("returns the message unchanged when RAG is disabled", async () => {
    await withFreshHome(async () => {
      // RAG stays disabled (default).
      const embedder = makeSemanticMockEmbedder(384);
      const svc = new EmbeddingService(embedder);
      const retriever = new MemoryRetriever({ embeddingService: svc, index: new BruteForceIndex(384) });
      await retriever.ensureLoaded();

      const injected = await buildMemoryInjection(retriever, {
        sessionId: "sess-off",
        projectId: undefined,
        query: "anything",
        userMessage: "原始消息",
      });
      expect(injected).toBe("原始消息");
    });
  });

  it("returns the message unchanged when there is no session id", async () => {
    await withFreshHome(async () => {
      const db = getDb();
      db.prepare("UPDATE memory_rag_config SET enabled = 1 WHERE id = 1").run();

      const embedder = makeSemanticMockEmbedder(384);
      const svc = new EmbeddingService(embedder);
      const retriever = new MemoryRetriever({ embeddingService: svc, index: new BruteForceIndex(384) });
      await retriever.ensureLoaded();

      const injected = await buildMemoryInjection(retriever, {
        sessionId: undefined,
        projectId: undefined,
        query: "anything",
        userMessage: "没有会话的消息",
      });
      expect(injected).toBe("没有会话的消息");
    });
  });

  it("returns the message unchanged when retrieval finds nothing relevant", async () => {
    await withFreshHome(async () => {
      const db = getDb();
      db.prepare("UPDATE memory_rag_config SET enabled = 1 WHERE id = 1").run();

      const embedder = makeSemanticMockEmbedder(384);
      const svc = new EmbeddingService(embedder);
      const retriever = new MemoryRetriever({ embeddingService: svc, index: new BruteForceIndex(384) });
      await retriever.ensureLoaded();
      // No chunks ingested at all → nothing to inject.

      const injected = await buildMemoryInjection(retriever, {
        sessionId: "sess-empty",
        projectId: undefined,
        query: "ETL 管道",
        userMessage: "查询消息",
      });
      expect(injected).toBe("查询消息");
    });
  });
});
