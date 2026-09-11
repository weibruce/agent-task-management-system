/**
 * MemoryRetriever: orchestrates redaction → chunking → embedding → storage
 * (ingest) and scoped cosine search (retrieve) over the memory_chunks table.
 *
 * Scope model
 * -----------
 * Every chunk carries (scope, scope_key):
 *   - session  → scope_key = session_id
 *   - project  → scope_key = project_id
 *   - global   → scope_key = "*"
 *
 * Retrieval for a (sessionId, projectId?) context returns the union of:
 *   1. session-scoped chunks of this session, and
 *   2. project + global chunks (when projectId is known / always for global).
 * The in-memory index holds the full corpus; scope filtering happens after
 * cosine search so topK is applied to the *visible* set, not the corpus.
 *
 * Redaction
 * ---------
 * All content passes through atms-protocol's redactTelemetry before
 * chunking. Embeddings are computed on the redacted text; the stored
 * `content` column is also the redacted text, so nothing sensitive ever
 * reaches the DB or the prompt.
 *
 * The class is stateless with respect to configuration: it reads
 * memory_rag_config on every operation (cheap single-row read), so runtime
 * toggles (enable/disable, top_k, min_score) take effect immediately.
 */

import { redactTelemetry, sha256Hex } from "atms-protocol";

import { getDb } from "../persistence/db.js";
import { nowIso } from "../persistence/time.js";
import { chunkText } from "./chunker.js";
import type { EmbeddingService } from "./embedding-service.js";
import type { VectorIndex } from "./vector-index.js";

export type MemoryScope = "session" | "project" | "global";
export type MemorySource = "session" | "experience" | "manual";

export interface MemoryChunkRow {
  id: string;
  scope: MemoryScope;
  scopeKey: string;
  sessionId: string | null;
  runId: string | null;
  source: MemorySource;
  content: string;
  contentHash: string;
  embedding: Float32Array;
  dim: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RetrievedChunk extends MemoryChunkRow {
  score: number;
}

export interface IngestResult {
  /** Number of new chunks written. */
  ingested: number;
  /** Number of inputs skipped (empty, duplicate hash, or RAG disabled). */
  skipped: number;
  /** Ids of the chunks actually written. */
  chunkIds: string[];
}

export interface RetrieveParams {
  sessionId?: string;
  projectId?: string;
  query: string;
  topK?: number;
  minScore?: number;
}

export interface MemoryRetrieverOptions {
  embeddingService: EmbeddingService;
  index: VectorIndex<MemoryChunkRow>;
}

export interface RagConfig {
  enabled: boolean;
  modelId: string;
  dim: number;
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  minScore: number;
  maxChunks: number;
  injectPosition: string;
}

export function readRagConfig(): RagConfig {
  const row = getDb().prepare("SELECT * FROM memory_rag_config WHERE id = 1").get() as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("memory_rag_config seed row is missing (run schema migrations)");
  }
  return {
    enabled: row.enabled === 1,
    modelId: row.model_id as string,
    dim: row.dim as number,
    chunkSize: row.chunk_size as number,
    chunkOverlap: row.chunk_overlap as number,
    topK: row.top_k as number,
    minScore: row.min_score as number,
    maxChunks: row.max_chunks as number,
    injectPosition: row.inject_position as string,
  };
}

export class MemoryRetriever {
  private readonly embeddingService: EmbeddingService;
  private readonly index: VectorIndex<MemoryChunkRow>;
  private loaded = false;

  constructor(options: MemoryRetrieverOptions) {
    this.embeddingService = options.embeddingService;
    this.index = options.index;
  }

  /** Current in-memory index size. */
  get indexSize(): number {
    return this.index.size;
  }

  /**
   * Load all chunks from the database into the in-memory index (idempotent).
   * Must be called before the first retrieve/ingest that depends on the index.
   */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, scope, scope_key, session_id, run_id, source, content,
             content_hash, embedding, dim, metadata, created_at, updated_at
      FROM memory_chunks ORDER BY created_at ASC
    `).all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      const chunk = parseChunkRow(row);
      this.index.add(chunk.id, chunk.embedding, chunk);
    }
    this.loaded = true;
  }

  /**
   * Ingest one session message (user or assistant). Chunks are stored under
   * scope='session', scope_key=sessionId. Content is redacted first.
   */
  async ingestSessionMessage(params: {
    sessionId: string;
    role: "user" | "assistant";
    content: string;
    runId?: string;
  }): Promise<IngestResult> {
    const config = readRagConfig();
    if (!config.enabled) {
      return { ingested: 0, skipped: 1, chunkIds: [] };
    }
    const redacted = (redactTelemetry(params.content) as string | undefined) ?? "";
    if (!redacted.trim()) {
      return { ingested: 0, skipped: 1, chunkIds: [] };
    }
    const chunks = chunkText(redacted, { size: config.chunkSize, overlap: config.chunkOverlap });
    if (chunks.length === 0) {
      return { ingested: 0, skipped: 1, chunkIds: [] };
    }
    await this.ensureLoaded();
    return this.persistChunks({
      scope: "session",
      scopeKey: params.sessionId,
      sessionId: params.sessionId,
      runId: params.runId ?? null,
      source: "session",
      contents: chunks,
      metadata: { role: params.role },
      config,
    });
  }

  /** Ingest an experience/manual memory item under an arbitrary scope. */
  async ingestExperience(params: {
    scope: MemoryScope;
    scopeKey: string;
    content: string;
    metadata?: Record<string, unknown>;
    runId?: string;
  }): Promise<IngestResult> {
    const config = readRagConfig();
    if (!config.enabled) {
      return { ingested: 0, skipped: 1, chunkIds: [] };
    }
    const redacted = (redactTelemetry(params.content) as string | undefined) ?? "";
    if (!redacted.trim()) {
      return { ingested: 0, skipped: 1, chunkIds: [] };
    }
    const chunks = chunkText(redacted, { size: config.chunkSize, overlap: config.chunkOverlap });
    if (chunks.length === 0) {
      return { ingested: 0, skipped: 1, chunkIds: [] };
    }
    await this.ensureLoaded();
    return this.persistChunks({
      scope: params.scope,
      scopeKey: params.scopeKey,
      sessionId: params.scope === "session" ? params.scopeKey : null,
      runId: params.runId ?? null,
      source: params.scope === "global" ? "manual" : "experience",
      contents: chunks,
      metadata: params.metadata ?? {},
      config,
    });
  }

  /**
   * Retrieve the most relevant visible chunks for a query.
   * Visibility: session chunks of `sessionId` + (project chunks of `projectId`)
   * + global chunks. Results are sorted by descending cosine score and
   * filtered by minScore before topK is applied.
   */
  async retrieveSessionMemory(params: RetrieveParams): Promise<RetrievedChunk[]> {
    const config = readRagConfig();
    if (!config.enabled || !params.query.trim()) {
      return [];
    }
    await this.ensureLoaded();
    const topK = params.topK ?? config.topK;
    const minScore = params.minScore ?? config.minScore;
    // Search a wider candidate set so scope filtering doesn't starve topK.
    const candidates = this.index.search(
      (await this.embeddingService.embed([params.query]))[0]!,
      topK * 4,
      minScore,
    );
    const visible = candidates
      .filter((entry) => this.isVisible(entry.payload!, params))
      .map((entry) => ({ ...entry.payload!, score: entry.score })) as RetrievedChunk[];
    visible.sort((a, b) => b.score - a.score);
    return visible.slice(0, topK);
  }

  /**
   * Build the prompt-injection block for the Manager/Voice Agent system
   * prompt. Returns "" when RAG is disabled or nothing is retrieved.
   */
  async buildMemoryContext(params: RetrieveParams): Promise<string> {
    const results = await this.retrieveSessionMemory(params);
    if (results.length === 0) return "";
    const lines = results.map((r, i) => {
      const provenance = r.source === "session"
        ? `来源: 会话 ${r.sessionId ?? r.scopeKey}`
        : `来源: ${r.scope} ${r.scopeKey}`;
      return `${i + 1}. [score=${r.score.toFixed(3)}, ${provenance}] ${r.content}`;
    });
    return [
      "## 长期记忆检索结果（与本次请求相关的历史上下文，仅供参考）",
      ...lines,
    ].join("\n");
  }

  /** Delete all chunks belonging to a session. Returns the number removed. */
  deleteSessionMemory(sessionId: string): number {
    const db = getDb();
    const rows = db.prepare("SELECT id FROM memory_chunks WHERE session_id = ?").all(sessionId) as Array<{ id: string }>;
    if (rows.length > 0) {
      const stmt = db.prepare("DELETE FROM memory_chunks WHERE id = ?");
      db.transaction(() => {
        for (const row of rows) {
          stmt.run(row.id);
          this.index.remove(row.id);
        }
      })();
    }
    return rows.length;
  }

  private isVisible(chunk: MemoryChunkRow, params: RetrieveParams): boolean {
    if (chunk.scope === "session") {
      return params.sessionId !== undefined && chunk.scopeKey === params.sessionId;
    }
    if (chunk.scope === "project") {
      return params.projectId !== undefined && chunk.scopeKey === params.projectId;
    }
    // global
    return true;
  }

  private async persistChunks(params: {
    scope: MemoryScope;
    scopeKey: string;
    sessionId: string | null;
    runId: string | null;
    source: MemorySource;
    contents: string[];
    metadata: Record<string, unknown>;
    config: RagConfig;
  }): Promise<IngestResult> {
    const db = getDb();
    const existing = db.prepare("SELECT content_hash FROM memory_chunks WHERE content_hash = ?");
    const fresh: Array<{ content: string; hash: string }> = [];
    for (const content of params.contents) {
      const hash = sha256Hex(content);
      if (existing.get(hash)) continue;
      fresh.push({ content, hash });
    }
    if (fresh.length === 0) {
      return { ingested: 0, skipped: params.contents.length, chunkIds: [] };
    }

    // Enforce max_chunks: drop oldest chunks (across all scopes) if over cap.
    this.enforceMaxChunks(params.config.maxChunks);

    const vectors = await this.embeddingService.embed(fresh.map((f) => f.content));
    const now = nowIso();
    const insert = db.prepare(`
      INSERT INTO memory_chunks (
        id, scope, scope_key, session_id, run_id, source,
        content, content_hash, embedding, dim, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const metadataJson = JSON.stringify(params.metadata);
    const written: string[] = [];
    db.transaction(() => {
      for (let i = 0; i < fresh.length; i += 1) {
        const id = `chunk_${sha256Hex(`${params.scopeKey}:${fresh[i]!.hash}:${now}`)}`;
        insert.run(
          id, params.scope, params.scopeKey, params.sessionId, params.runId, params.source,
          fresh[i]!.content, fresh[i]!.hash, Buffer.from(vectors[i]!.buffer, vectors[i]!.byteOffset, vectors[i]!.byteLength),
          vectors[i]!.length, metadataJson, now, now,
        );
        const row: MemoryChunkRow = {
          id,
          scope: params.scope,
          scopeKey: params.scopeKey,
          sessionId: params.sessionId,
          runId: params.runId,
          source: params.source,
          content: fresh[i]!.content,
          contentHash: fresh[i]!.hash,
          embedding: vectors[i]!,
          dim: vectors[i]!.length,
          metadata: params.metadata,
          createdAt: now,
          updatedAt: now,
        };
        this.index.add(id, vectors[i]!, row);
        written.push(id);
      }
    })();
    return { ingested: written.length, skipped: params.contents.length - fresh.length, chunkIds: written };
  }

  private enforceMaxChunks(maxChunks: number): void {
    const db = getDb();
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM memory_chunks").get() as { n: number };
    const overflow = n + 1 - maxChunks; // +1 for the chunk about to be inserted
    if (overflow <= 0) return;
    const victims = db.prepare(`
      SELECT id FROM memory_chunks ORDER BY created_at ASC, id ASC LIMIT ?
    `).all(overflow) as Array<{ id: string }>;
    const del = db.prepare("DELETE FROM memory_chunks WHERE id = ?");
    db.transaction(() => {
      for (const v of victims) {
        del.run(v.id);
        this.index.remove(v.id);
      }
    })();
  }
}

function parseChunkRow(row: Record<string, unknown>): MemoryChunkRow {
  const embeddingBuf = row.embedding as Buffer;
  const embedding = new Float32Array(
    embeddingBuf.buffer,
    embeddingBuf.byteOffset,
    embeddingBuf.byteLength / 4,
  );
  return {
    id: row.id as string,
    scope: row.scope as MemoryScope,
    scopeKey: row.scope_key as string,
    sessionId: (row.session_id as string | null) ?? null,
    runId: (row.run_id as string | null) ?? null,
    source: row.source as MemorySource,
    content: row.content as string,
    contentHash: row.content_hash as string,
    embedding,
    dim: row.dim as number,
    metadata: (row.metadata ? JSON.parse(row.metadata as string) : {}) as Record<string, unknown>,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
