/**
 * Fixed-size text chunker with overlap.
 *
 * Splits text into character-based windows of `size` characters, stepping by
 * `size - overlap`. Character-based (not word/sentence) splitting is
 * deliberate: it is deterministic, has zero dependencies, and is safe for CJK
 * text where word boundaries are ambiguous. The overlap guarantees that a
 * sentence straddling a boundary is preserved in full in at least one chunk.
 */

export interface ChunkOptions {
  /** Maximum chunk length in characters. Must be > 0. */
  size: number;
  /** Number of characters shared between consecutive chunks. Must be < size. */
  overlap: number;
}

/**
 * Split `text` into overlapping chunks.
 *
 * Returns [] for empty/whitespace-only input. The last chunk may be shorter
 * than `size` when the remainder is below one step.
 */
export function chunkText(text: string, options: ChunkOptions): string[] {
  const { size, overlap } = options;
  if (size <= 0) throw new Error(`chunk size must be > 0, got ${size}`);
  if (overlap < 0) throw new Error(`chunk overlap must be >= 0, got ${overlap}`);
  if (overlap >= size) throw new Error(`chunk overlap (${overlap}) must be < size (${size})`);

  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= size) return [trimmed];

  const step = size - overlap;
  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    const end = Math.min(start + size, trimmed.length);
    chunks.push(trimmed.slice(start, end));
    if (end === trimmed.length) break;
    start += step;
  }
  return chunks;
}
