/**
 * In-memory brute-force vector index over Float32Array embeddings.
 *
 * Chosen over sqlite-vec for the initial implementation: zero native
 * dependencies, trivially testable, and cosine search over ≤ 50 000 vectors of
 * 384 dims completes in single-digit milliseconds on commodity hardware.
 * The `VectorIndex` interface is the seam for a future swap to a native
 * ANN backend without touching callers.
 */

export interface ScoredEntry<T = unknown> {
  id: string;
  score: number;
  payload: T;
}

export interface VectorIndex<T = unknown> {
  readonly dim: number;
  readonly size: number;
  add(id: string, vector: Float32Array, payload?: T): void;
  remove(id: string): void;
  search(query: Float32Array, topK: number, minScore?: number): Array<ScoredEntry<T>>;
}

/** L2-normalize a vector in place-safe fashion (returns a new array). */
export function normalizeVector(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i += 1) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return new Float32Array(v.length);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 1) out[i] = v[i] / norm;
  return out;
}

/**
 * Cosine similarity in [-1, 1]. Returns 0 when either vector has zero norm.
 * Inputs are NOT assumed pre-normalized — normalization happens here.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export class BruteForceIndex<T = unknown> implements VectorIndex<T> {
  readonly dim: number;
  private readonly ids: string[] = [];
  private readonly vectors: Float32Array[] = [];
  private readonly payloads: T[] = [];
  private readonly idToSlot = new Map<string, number>();

  constructor(dim: number) {
    if (dim <= 0) throw new Error(`dim must be > 0, got ${dim}`);
    this.dim = dim;
  }

  get size(): number {
    return this.ids.length;
  }

  add(id: string, vector: Float32Array, payload?: T): void {
    if (vector.length !== this.dim) {
      throw new Error(`vector dim ${vector.length} does not match index dim ${this.dim}`);
    }
    const existing = this.idToSlot.get(id);
    if (existing !== undefined) {
      // Replace in place.
      this.vectors[existing] = vector;
      if (payload !== undefined) this.payloads[existing] = payload;
      return;
    }
    this.idToSlot.set(id, this.ids.length);
    this.ids.push(id);
    this.vectors.push(vector);
    this.payloads.push(payload as T);
  }

  remove(id: string): void {
    const slot = this.idToSlot.get(id);
    if (slot === undefined) return;
    const last = this.ids.length - 1;
    if (slot !== last) {
      // Swap-remove: move the last element into the vacated slot.
      this.idToSlot.set(this.ids[last]!, slot);
      this.ids[slot] = this.ids[last]!;
      this.vectors[slot] = this.vectors[last]!;
      this.payloads[slot] = this.payloads[last]!;
    }
    this.ids.pop();
    this.vectors.pop();
    this.payloads.pop();
    this.idToSlot.delete(id);
  }

  search(query: Float32Array, topK: number, minScore?: number): Array<ScoredEntry<T>> {
    if (query.length !== this.dim) {
      throw new Error(`query dim ${query.length} does not match index dim ${this.dim}`);
    }
    if (topK <= 0 || this.ids.length === 0) return [];

    const scored: Array<{ id: string; score: number; payload: T }> = [];
    for (let i = 0; i < this.ids.length; i += 1) {
      const score = cosineSimilarity(query, this.vectors[i]!);
      if (minScore !== undefined && score < minScore) continue;
      scored.push({ id: this.ids[i]!, score, payload: this.payloads[i]! });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}
