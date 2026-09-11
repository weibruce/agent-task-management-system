import { describe, expect, it } from "vitest";

import { EmbeddingService, type Embedder } from "../src/rag/embedding-service.js";

/**
 * Deterministic mock embedder: hashes text into a fixed-dim vector with a
 * stable, reproducible mapping. Similar texts (sharing prefixes) get similar
 * vectors, which is enough to exercise the service's caching / batching logic
 * without loading the 47 MB real model on every test run.
 */
function makeMockEmbedder(dim: number): Embedder {
  let callCount = 0;
  return {
    modelId: "mock-model",
    dim,
    async embed(texts: string[]): Promise<Float32Array[]> {
      callCount += 1;
      return texts.map((t) => {
        const vec = new Float32Array(dim);
        // Deterministic pseudo-vector from text content.
        let h = 2166136261;
        for (let i = 0; i < t.length; i += 1) {
          h ^= t.charCodeAt(i);
          h = Math.imul(h, 16777619) >>> 0;
        }
        let seed = h;
        for (let i = 0; i < dim; i += 1) {
          seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
          vec[i] = (seed / 0xffffffff) * 2 - 1;
        }
        // Normalize.
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

describe("EmbeddingService (mock embedder)", () => {
  it("embeds a single text", async () => {
    const svc = new EmbeddingService(makeMockEmbedder(8));
    const [vec] = await svc.embed(["hello"]);
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(8);
  });

  it("embeds multiple texts in one call (batch)", async () => {
    const embedder = makeMockEmbedder(8);
    const svc = new EmbeddingService(embedder);
    const vecs = await svc.embed(["a", "b", "c"]);
    expect(vecs).toHaveLength(3);
    // All three texts should go to the embedder in a single call.
    expect(embedder.getCallCount()).toBe(1);
  });

  it("caches results: identical text does not re-embed", async () => {
    const embedder = makeMockEmbedder(8);
    const svc = new EmbeddingService(embedder);
    const first = await svc.embed(["cached text"]);
    const second = await svc.embed(["cached text"]);
    expect(second[0]).toEqual(first[0]);
    // Only one actual embedder call for two identical inputs.
    expect(embedder.getCallCount()).toBe(1);
  });

  it("cache is per-text: different texts both hit the embedder", async () => {
    const embedder = makeMockEmbedder(8);
    const svc = new EmbeddingService(embedder);
    await svc.embed(["one"]);
    await svc.embed(["two"]);
    expect(embedder.getCallCount()).toBe(2);
  });

  it("clearCache resets the cache", async () => {
    const embedder = makeMockEmbedder(8);
    const svc = new EmbeddingService(embedder);
    await svc.embed(["x"]);
    svc.clearCache();
    await svc.embed(["x"]);
    expect(embedder.getCallCount()).toBe(2);
  });

  it("returns empty array for empty input", async () => {
    const svc = new EmbeddingService(makeMockEmbedder(8));
    expect(await svc.embed([])).toEqual([]);
  });

  it("exposes dim from the embedder", () => {
    const svc = new EmbeddingService(makeMockEmbedder(384));
    expect(svc.dim).toBe(384);
  });
});
