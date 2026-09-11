/**
 * RAG retrieval evaluation (Recall@5 / MRR) over the labeled set in
 * evals/rag-eval-set.json. Run directly with vitest (the file lives outside
 * the default tests/ include, so it is not picked up by `npm test`):
 *
 *   npm run eval:rag
 *   RAG_EVAL_REAL=1 npm run eval:rag   # real model (slow, ~1 min)
 *
 * Writes a human-readable report to evals/rag-eval-report.txt.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { expect, it } from "vitest";

import { closeDb, getDb } from "../src/persistence/db.js";
import { MemoryRetriever } from "../src/rag/memory-retriever.js";
import { EmbeddingService, type Embedder } from "../src/rag/embedding-service.js";
import { BruteForceIndex } from "../src/rag/vector-index.js";
import { getRagRuntime, resetRagRuntime } from "../src/rag/runtime.js";

const EVAL_SET_PATH = path.resolve(__dirname, "rag-eval-set.json");
const REPORT_PATH = path.resolve(__dirname, "rag-eval-report.txt");
const TOP_K = 5;

interface EvalEntry {
  id: string;
  query: string;
  relevant: string[];
  distractors: string[];
}

interface EvalSet {
  version: number;
  description: string;
  entries: EvalEntry[];
}

/**
 * Deterministic token-overlap mock embedder (same semantics as
 * rag-memory-retriever.test.ts / memory-rag-delete.test.ts). Keeps the eval
 * runnable offline and in CI without downloading the model.
 */
function makeSemanticMockEmbedder(dim: number): Embedder {
  const STOP = new Set(["the", "a", "an", "of", "to", "in", "is", "how", "and", "with", "for"]);
  const CJK_RE = /[^一-鿿]/g;
  const CJK_SPLIT_RE = /\s+/;
  const NON_WORD_RE = /[^\w\s]/g;
  function tokens(text: string): Set<string> {
    const out = new Set<string>();
    const cjk = text.replace(CJK_RE, " ").split(CJK_SPLIT_RE).filter(Boolean);
    for (const w of cjk) {
      for (let i = 0; i < w.length - 1; i += 1) out.add(w.slice(i, i + 2));
      if (w.length === 1) out.add(w);
    }
    for (const w of text.toLowerCase().replace(NON_WORD_RE, " ").split(CJK_SPLIT_RE)) {
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

async function buildRetriever(useReal: boolean): Promise<MemoryRetriever> {
  if (useReal) {
    const { retriever } = await getRagRuntime();
    await retriever.ensureLoaded();
    return retriever;
  }
  const retriever = new MemoryRetriever({
    embeddingService: new EmbeddingService(makeSemanticMockEmbedder(384)),
    index: new BruteForceIndex(384),
  });
  await retriever.ensureLoaded();
  return retriever;
}

function withFreshHome(fn: () => Promise<void>): Promise<void> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "atms-rag-eval-"));
  const prev = process.env.ATMS_HOME;
  process.env.ATMS_HOME = home;
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

const LATIN_RE = /[A-Za-z]{3,}/;
const HAS_CJK_RE = /[一-鿿]/;

async function main(): Promise<void> {
  const useReal = process.env.RAG_EVAL_REAL === "1";
  const set = JSON.parse(fs.readFileSync(EVAL_SET_PATH, "utf8")) as EvalSet;

  // Sanity: the set itself must be well-formed and cover zh + en.
  expect(set.version).toBe(1);
  expect(set.entries.length).toBeGreaterThanOrEqual(14);
  for (const entry of set.entries) {
    expect(entry.id).toBeTruthy();
    expect(entry.query.trim()).not.toBe("");
    expect(entry.relevant.length).toBeGreaterThan(0);
  }
  expect(set.entries.some((e) => LATIN_RE.test(e.query))).toBe(true);
  expect(set.entries.some((e) => HAS_CJK_RE.test(e.query))).toBe(true);

  await withFreshHome(async () => {
    getDb().prepare("UPDATE memory_rag_config SET enabled = 1 WHERE id = 1").run();
    const retriever = await buildRetriever(useReal);

    const seen = new Set<string>();
    for (const entry of set.entries) {
      for (const content of [...entry.relevant, ...entry.distractors]) {
        if (seen.has(content)) continue;
        seen.add(content);
        await retriever.ingestExperience({ scope: "global", scopeKey: "*", content });
      }
    }
    expect(retriever.indexSize).toBe(seen.size);

    let recallHits = 0;
    let reciprocalRankSum = 0;
    const perEntry: Array<{ id: string; query: string; hitAt: number }> = [];
    for (const entry of set.entries) {
      const results = await retriever.retrieveSessionMemory({
        query: entry.query,
        topK: TOP_K,
        minScore: 0,
      });
      const hitAt = results.findIndex((r) => entry.relevant.includes(r.content)) + 1;
      if (hitAt > 0) recallHits += 1;
      if (hitAt > 0) reciprocalRankSum += 1 / hitAt;
      perEntry.push({ id: entry.id, query: entry.query, hitAt });
    }

    const recallAt5 = recallHits / set.entries.length;
    const mrr = reciprocalRankSum / set.entries.length;

    const lines: string[] = [];
    lines.push(`RAG retrieval eval report (${useReal ? "real model" : "mock embedder"}, top-k=${TOP_K})`);
    lines.push(`entries=${set.entries.length} corpus=${retriever.indexSize}`);
    for (const e of perEntry) {
      lines.push(`  ${e.hitAt > 0 ? `hit@${e.hitAt}` : "miss  "}  ${e.id}  "${e.query}"`);
    }
    lines.push(`Recall@${TOP_K}=${recallAt5.toFixed(3)} MRR=${mrr.toFixed(3)}`);
    const report = lines.join("\n");
    // eslint-disable-next-line no-console
    console.log(report);
    fs.writeFileSync(REPORT_PATH, report + "\n", "utf8");
    // eslint-disable-next-line no-console
    console.log(`report written to ${REPORT_PATH}`);

    // Acceptance thresholds (mock is a weak baseline; real model exceeds).
    expect(recallAt5).toBeGreaterThanOrEqual(0.5);
    expect(mrr).toBeGreaterThanOrEqual(0.3);
  });
}

it(`RAG retrieval evaluation (Recall@5 / MRR) — ${process.env.RAG_EVAL_REAL === "1" ? "real model" : "mock"}`, async () => {
  await main();
}, process.env.RAG_EVAL_REAL === "1" ? 600_000 : 300_000);
