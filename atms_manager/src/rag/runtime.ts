/**
 * RAG runtime singleton for the Manager process.
 *
 * One EmbeddingService + BruteForceIndex + MemoryRetriever per process.
 * The embedding model is loaded lazily on the first turn that actually
 * needs it (RAG enabled + non-trivial query), so Manager startup is
 * unaffected and a machine without network/model access can still run
 * ATMS with RAG disabled.
 */

import * as os from "node:os";
import * as path from "node:path";

import {
  BruteForceIndex,
  type VectorIndex,
} from "./vector-index.js";
import {
  DEFAULT_EMBEDDING_DIM,
  EmbeddingService,
  createTransformersEmbedder,
  resetTransformersPipelineForTests,
  type EmbeddingService as EmbeddingServiceType,
} from "./embedding-service.js";
import { MemoryRetriever, type MemoryChunkRow, readRagConfig } from "./memory-retriever.js";

export interface RagRuntime {
  retriever: MemoryRetriever;
  embeddingService: EmbeddingServiceType;
  index: VectorIndex<MemoryChunkRow>;
}

let runtimePromise: Promise<RagRuntime> | undefined;

function modelCacheDir(): string {
  const atmsHome = process.env.ATMS_HOME
    ?? path.join(os.homedir(), ".atms");
  return path.join(atmsHome, "rag-models");
}

/**
 * Get (or lazily create) the process-wide RAG runtime.
 * The transformers model is NOT downloaded here — only on the first
 * `embed()` call, which happens inside `ensureLoaded`/`retrieveSessionMemory`.
 */
export function getRagRuntime(): Promise<RagRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const config = readRagConfig();
      const embeddingService = new EmbeddingService(
        createTransformersEmbedder(config.modelId, config.dim, modelCacheDir()),
      );
      const index = new BruteForceIndex<MemoryChunkRow>(config.dim);
      const retriever = new MemoryRetriever({ embeddingService, index });
      return { retriever, embeddingService, index };
    })();
    runtimePromise.catch(() => {
      runtimePromise = undefined; // allow retry after a transient failure
    });
  }
  return runtimePromise;
}

/**
 * Test seam: reset the singleton so tests can inject a mock-backed runtime.
 */
export function resetRagRuntime(): void {
  runtimePromise = undefined;
  resetTransformersPipelineForTests();
}
