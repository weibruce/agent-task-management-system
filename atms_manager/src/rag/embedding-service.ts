/**
 * EmbeddingService: wraps a local embedding model (via @xenova/transformers)
 * with text-level caching and batched inference.
 *
 * The `Embedder` interface is the seam between the service and the model
 * backend. Production uses `createTransformersEmbedder`, which lazy-loads the
 * ONNX model on first use and caches it for the process lifetime. Tests
 * inject a deterministic mock embedder to avoid downloading the model.
 */

import { pipeline, env as transformersEnv } from "@xenova/transformers";

export interface Embedder {
  /** Model identifier (HuggingFace repo id or alias). */
  readonly modelId: string;
  /** Embedding dimensionality. */
  readonly dim: number;
  /** Embed a batch of texts. Returns one vector per input, in order. */
  embed(texts: string[]): Promise<Float32Array[]>;
}

/** feature-extraction pipeline: callable (text, opts) → { data: number[] } */
type FeatureExtractorPipeline = (
  input: string | string[],
  options?: Record<string, unknown>,
) => Promise<{ data: ArrayLike<number> } | { data: ArrayLike<number> }[]>;

/**
 * Default embedding model. Selected by benchmark (scripts/rag-model-benchmark.ts):
 * multilingual MiniLM L12 scores 0.60–0.78 on Chinese↔English Atms-style
 * semantic pairs vs 0.43–0.68 for the English-only L6, at 15 ms median warm
 * latency. 384 dims.
 */
export const DEFAULT_EMBEDDING_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
export const DEFAULT_EMBEDDING_DIM = 384;

let transformersPipelinePromise: Promise<FeatureExtractorPipeline> | undefined;
let configuredModelId: string | undefined;

function loadTransformersPipeline(modelId: string, cacheDir?: string): Promise<FeatureExtractorPipeline> {
  if (!transformersPipelinePromise || configuredModelId !== modelId) {
    if (cacheDir) transformersEnv.cacheDir = cacheDir;
    configuredModelId = modelId;
    transformersPipelinePromise = pipeline("feature-extraction", modelId, {
      quantized: true,
    }) as unknown as Promise<FeatureExtractorPipeline>;
  }
  return transformersPipelinePromise;
}

/** Test seam: allow a fresh pipeline after model/ATMS_HOME changes. */
export function resetTransformersPipelineForTests(): void {
  transformersPipelinePromise = undefined;
  configuredModelId = undefined;
}

/**
 * Create a production embedder backed by @xenova/transformers.
 * The model is downloaded to `cacheDir` (default: HF cache under ATMS_HOME)
 * on first `embed()` call and kept in memory afterwards.
 */
export function createTransformersEmbedder(
  modelId: string = DEFAULT_EMBEDDING_MODEL,
  dim: number = DEFAULT_EMBEDDING_DIM,
  cacheDir?: string,
): Embedder {
  return {
    modelId,
    dim,
    async embed(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      const p = await loadTransformersPipeline(modelId, cacheDir);
      const results = await Promise.all(
        texts.map((text) => p(text, { pooling: "mean", normalize: true })),
      );
      return results.map((r) => Float32Array.from((r as { data: ArrayLike<number> }).data));
    },
  };
}

/**
 * EmbeddingService with an LRU-style text cache.
 *
 * The cache key is the exact text string. Cache is bounded by `maxEntries`;
 * when exceeded, the oldest entry is evicted (simple FIFO — sufficient for a
 * bounded session/project corpus).
 */
export class EmbeddingService {
  readonly dim: number;
  private readonly embedder: Embedder;
  private readonly cache = new Map<string, Float32Array>();
  private readonly maxEntries: number;

  constructor(embedder: Embedder, maxEntries: number = 4096) {
    this.embedder = embedder;
    this.dim = embedder.dim;
    this.maxEntries = maxEntries;
  }

  /** The model id backing this service. */
  get modelId(): string {
    return this.embedder.modelId;
  }

  /**
   * Embed one or more texts. Already-cached texts are served from the cache;
   * uncached texts are batched into a single embedder call.
   */
  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const out: Float32Array[] = new Array(texts.length);
    const toEmbed: Array<{ index: number; text: string }> = [];
    for (let i = 0; i < texts.length; i += 1) {
      const text = texts[i];
      const cached = this.cache.get(text);
      if (cached) {
        out[i] = cached;
      } else {
        toEmbed.push({ index: i, text });
      }
    }
    if (toEmbed.length > 0) {
      const vectors = await this.embedder.embed(toEmbed.map((e) => e.text));
      for (let j = 0; j < toEmbed.length; j += 1) {
        const { index, text } = toEmbed[j]!;
        out[index] = vectors[j]!;
        this.cacheSet(text, vectors[j]!);
      }
    }
    return out;
  }

  /** Drop all cached vectors. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Number of distinct texts currently cached. */
  get cacheSize(): number {
    return this.cache.size;
  }

  private cacheSet(text: string, vector: Float32Array): void {
    if (this.cache.size >= this.maxEntries) {
      // Evict oldest (first-inserted) entry.
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(text, vector);
  }
}
