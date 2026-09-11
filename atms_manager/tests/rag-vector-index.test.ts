import { describe, expect, it } from "vitest";

import { BruteForceIndex, cosineSimilarity, normalizeVector } from "../src/rag/vector-index.js";

describe("vector math helpers", () => {
  it("normalizeVector produces a unit vector", () => {
    const v = new Float32Array([3, 4]);
    const n = normalizeVector(v);
    expect(Math.sqrt(n[0] * n[0] + n[1] * n[1])).toBeCloseTo(1, 5);
  });

  it("normalizeVector of a zero vector stays zero (no NaN)", () => {
    const n = normalizeVector(new Float32Array([0, 0, 0]));
    expect([...n]).toEqual([0, 0, 0]);
  });

  it("cosineSimilarity: identical → 1, orthogonal → 0, opposite → -1", () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBeCloseTo(1, 5);
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 5);
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([-1, 0]))).toBeCloseTo(-1, 5);
  });

  it("cosineSimilarity of a zero vector is 0", () => {
    expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
  });
});

describe("BruteForceIndex", () => {
  it("search returns entries in descending score order", () => {
    const index = new BruteForceIndex(3);
    index.add("a", new Float32Array([1, 0, 0]));
    index.add("b", new Float32Array([0.9, 0.1, 0]));
    index.add("c", new Float32Array([0, 1, 0]));
    const results = index.search(new Float32Array([1, 0, 0]), 3);
    expect(results.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(results[0].score).toBeCloseTo(1, 5);
    expect(results[1].score).toBeLessThan(results[0].score);
  });

  it("search respects topK", () => {
    const index = new BruteForceIndex(2);
    index.add("a", new Float32Array([1, 0]));
    index.add("b", new Float32Array([0.99, 0.01]));
    index.add("c", new Float32Array([0.98, 0.02]));
    const results = index.search(new Float32Array([1, 0]), 2);
    expect(results).toHaveLength(2);
  });

  it("search on empty index returns []", () => {
    const index = new BruteForceIndex(2);
    expect(index.search(new Float32Array([1, 0]), 5)).toEqual([]);
  });

  it("minScore filters out low-score entries", () => {
    const index = new BruteForceIndex(2);
    index.add("near", new Float32Array([1, 0]));
    index.add("far", new Float32Array([0, 1]));
    const results = index.search(new Float32Array([1, 0]), 5, 0.5);
    expect(results.map((r) => r.id)).toEqual(["near"]);
  });

  it("remove deletes an entry", () => {
    const index = new BruteForceIndex(2);
    index.add("a", new Float32Array([1, 0]));
    index.add("b", new Float32Array([0, 1]));
    index.remove("a");
    expect(index.size).toBe(1);
    expect(index.search(new Float32Array([1, 0]), 5).map((r) => r.id)).toEqual(["b"]);
  });

  it("replace updates an existing entry in place", () => {
    const index = new BruteForceIndex(2);
    index.add("a", new Float32Array([1, 0]));
    index.add("a", new Float32Array([0, 1]));
    expect(index.size).toBe(1);
    expect(index.search(new Float32Array([0, 1]), 1)[0].score).toBeCloseTo(1, 5);
  });

  it("dimension mismatch throws", () => {
    const index = new BruteForceIndex(2);
    expect(() => index.add("x", new Float32Array([1, 0, 0]))).toThrow();
    index.add("ok", new Float32Array([1, 0]));
    expect(() => index.search(new Float32Array([1, 0, 0]), 1)).toThrow();
  });

  it("handles 384-dim vectors correctly (real embedding size)", () => {
    const index = new BruteForceIndex(384);
    const target = new Float32Array(384);
    target[0] = 1;
    const exact = new Float32Array(384);
    exact[0] = 1;
    index.add("exact", exact);
    const other = new Float32Array(384).fill(1 / Math.sqrt(384));
    index.add("spread", other);
    const results = index.search(target, 2);
    expect(results[0].id).toBe("exact");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });
});
