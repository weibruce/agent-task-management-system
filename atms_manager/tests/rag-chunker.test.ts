import { describe, expect, it } from "vitest";

import { chunkText } from "../src/rag/chunker.js";

describe("chunkText (fixed-size + overlap, char-based)", () => {
  it("returns a single chunk for short text", () => {
    const chunks = chunkText("short text", { size: 512, overlap: 64 });
    expect(chunks).toEqual(["short text"]);
  });

  it("returns [] for empty or whitespace-only input", () => {
    expect(chunkText("", { size: 10, overlap: 2 })).toEqual([]);
    expect(chunkText("   \n  ", { size: 10, overlap: 2 })).toEqual([]);
  });

  it("splits long text with the configured overlap", () => {
    const text = "a".repeat(100);
    const chunks = chunkText(text, { size: 60, overlap: 20 });
    // First chunk: [0,60). Step 40 → second [40,100).
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(60);
    expect(chunks[1]).toHaveLength(60);
    // Overlap region: chars 40..59 of chunk0 must equal chars 0..19 of chunk1.
    expect(chunks[0].slice(40)).toBe(chunks[1].slice(0, 20));
    // Full coverage: reconstructing via the chunks yields the original text.
    expect(recover(chunks, 60, 20)).toBe(text);
  });

  it("every chunk except the last has exactly `size` characters", () => {
    const text = "abcdefghij".repeat(30); // 300 chars
    const chunks = chunkText(text, { size: 50, overlap: 10 });
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk).toHaveLength(50);
    }
  });

  it("overlap must be smaller than size", () => {
    expect(() => chunkText("x".repeat(10), { size: 10, overlap: 10 })).toThrow();
    expect(() => chunkText("x".repeat(10), { size: 10, overlap: 11 })).toThrow();
  });

  it("preserves CJK text without corrupting code points", () => {
    const text = "这是一段用于测试中文切分功能的文本。".repeat(5); // 50 CJK chars
    const chunks = chunkText(text, { size: 30, overlap: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // Each chunk must be a contiguous substring of the original.
      expect(text.includes(chunk)).toBe(true);
    }
    expect(recover(chunks, 30, 10)).toBe(text);
  });

  it("handles text shorter than size but longer than overlap", () => {
    const text = "hello world";
    const chunks = chunkText(text, { size: 20, overlap: 5 });
    expect(chunks).toEqual(["hello world"]);
  });
});

/** Re-join overlapping chunks to verify lossless coverage. */
function recover(chunks: string[], size: number, overlap: number): string {
  if (chunks.length === 0) return "";
  const step = size - overlap;
  let out = chunks[0];
  for (let i = 1; i < chunks.length; i += 1) {
    out += chunks[i].slice(overlap);
  }
  return out.slice(0, chunks.length === 1 ? chunks[0].length : out.length);
}
