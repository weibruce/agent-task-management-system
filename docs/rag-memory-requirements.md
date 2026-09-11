# ATMS RAG Long-Term Memory — Requirements & Design

> Version v1.0 · 2026-09-10 · Status: in development
> Audience: ATMS maintainers (Bruce) · Companion docs: `README.md`, `docs/architecture/durable-dag-actors.md`, `docs/dag-patterns.md`

---

## 1. Background & Motivation

ATMS's Manager Agent and Voice Agent currently have a **linear, full-history session context**:
`agent-sessions.ts` stores conversations in the SQLite `sessions` / `session_messages` tables
in sequence order, and `loadMessages` feeds the entire history back to the LLM on every turn.

ATMS also already has a layer of **structured memory infrastructure**:

| Existing facility | File | Role |
| --- | --- | --- |
| `memories` table | `persistence/db.ts` | Structured memory with `user_id / kind / last_accessed / data` |
| `experience_ingest_jobs` table | `persistence/experience-ingest-jobs.ts` | Experience collection job pipeline |
| `experience_nodes` / `experience_relationships` tables | `persistence/db.ts` | Experience graph (nodes + edges) |

**The gap**: that memory layer can only be read via **structured / keyword** lookups — there is
no **semantic (vector) retrieval**. Content that is *semantically* related, like "the data
pipeline requirement the user mentioned last week", cannot be recalled on demand. As session
history and the experience store grow, full-history context will overflow the window, add noise,
and dilute the relevant fragments.

**RAG (Retrieval-Augmented Generation)** fills exactly that gap: split content into chunks,
store embeddings, compute similarity at query time to recall the top-k chunks, and inject them
into the prompt — so the LLM sees the *most relevant* long-term memory **on demand**, instead of
being stuffed with the entire history.

---

## 2. Current State & Constraints (verified against the real codebase)

| Item | Current state | Impact on RAG |
| --- | --- | --- |
| DB | `better-sqlite3` with versioned migrations via `schema_migrations` (already past v30) | RAG tables go through the standard migration chain; new id assigned |
| Session layer | `agent-sessions.ts` (`sessions` / `session_messages`) | Injection point: after `loadMessages` |
| Existing memory | `memories` + `experience_*` tables + `experience-ingest-jobs.ts` | RAG is a **vector-retrieval enhancement** of this layer, not a replacement |
| LLM backends | claude-sdk / codex_appserver / kimi / deepseek (`atms_worker`) | Embeddings run on a separate local path, independent of workers |
| Runtime | Node **v26.7.0**, TypeScript, `vitest` | WASM vector index is an option; test framework is already in place |
| Network | HuggingFace **reachable (HTTP 200)**, models can be downloaded | Local embedding models can be fetched and cached |
| Security | Control-plane wss auth; credential redaction at the Manager trust boundary | RAG content is redacted before storage; no credentials are persisted |
| Positioning | Local / self-hosted, no external SaaS dependency | Embeddings are **purely local**; no cloud API calls |

**Hard constraints (non-negotiable)**

- RAG must be **local / self-hosted**: embeddings run locally; no cloud embedding API.
- Reuse the existing SQLite instance — **no new database process** (a WASM vector index is
  acceptable, in-process).
- Content must pass through the existing **credential redaction** before storage; no keys.
- Do not break the existing read/write contracts of `agent-sessions` and `experience_*`
  (RAG is a new read layer).
- Migrations must be **idempotent** and continue the `schema_migrations` chain.

---

## 3. Goals & Non-Goals

### 3.1 Goals (In Scope)

- Local embedding service: turn text into fixed-dimension vectors, in-process, with model caching.
- Vector storage: a chunk table in SQLite storing content + embedding + metadata.
- Chunking strategy: split session history / experience entries into retrievable chunks.
- Retrieval: embed the query, recall the top-k most relevant chunks (cosine similarity).
- Injection: splice recalled fragments into the Manager Agent / Voice Agent context
  (system prompt / prefix message).
- Write path: on session close / experience collection, embed content worth keeping long-term.
- Evaluation: measure retrieval quality with an eval harness (recall, relevant-chunk hits).
- CLI + API: `atms memory search/ingest/stats` plus corresponding HTTP endpoints.
- Tests: vitest coverage for chunking, embedding, retrieval, injection, redaction, migrations.

### 3.2 Non-Goals (Out of Scope for this phase)

- Multi-tenancy / cross-user isolation (ATMS is a single-user local system).
- Real-time streaming index updates (batch writes are sufficient for this phase).
- Graph RAG / multi-hop reasoning (`experience_relationships` already has a graph, but semantic
  graph retrieval is deferred).
- Distributed vector databases (Chroma / LanceDB are optional future evolution, see §10).
- Cross-language / multimodal embeddings (text only for this phase).

---

## 4. Technology Choices

### 4.1 Embedding model (recommended + alternatives)

| Option | Model | Dim | Runtime | Trade-offs |
| --- | --- | --- | --- | --- |
| **Recommended** | `Xenova/all-MiniLM-L6-v2` (sentence-transformers) | 384 | `@xenova/transformers` (ONNX Runtime Web, WASM, pure JS) | No native compilation, runs on CPU, downloadable from HF, fast enough, local |
| Alternative A | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | 384 | Same as above | Better on **mixed Chinese/English** (ATMS content includes Chinese); slightly larger model |
| Alternative B | `bge-small-zh-v1.5` / `bge-m3` | 512/1024 | Requires a local vLLM / TEI service | Best-in-class Chinese, but introduces an external model service process |
| Not recommended | OpenAI / Anthropic embeddings API | — | Cloud HTTP | Violates the local positioning; network + cost |

**Decision guidance**:
- If ATMS content is **Chinese-heavy** (which your scenario likely is) → go straight to
  **Alternative A (multilingual MiniLM)**: one model covers both languages, avoiding a later swap.
- If content is English-heavy → the recommended `all-MiniLM-L6-v2`.
- Both run under `@xenova/transformers`; switching only changes the model id — **no architecture
  change**.

> Before committing, run a real benchmark: ~200 Chinese + English samples, measuring per-text
> embed latency and recall quality, and let the data pick the final model — no guessing.

### 4.2 Vector storage & retrieval

| Scale | Approach | Notes |
| --- | --- | --- |
| < ~50k chunks (this phase) | **Embedding BLOB in SQLite + in-process brute-force cosine** | Zero new dependencies, explainable, fast enough; cold start loads vectors into memory |
| > ~50k chunks (later) | Introduce **HNSWlib / USearch (WASM)** in-process index | Still local, no new process; SQLite stays the persistence layer, WASM is the acceleration layer |

**This phase uses the left column** (brute-force cosine + in-memory cache). The right column is a
documented evolution path; the interface layer reserves a `VectorIndex` abstraction so swapping
implementations later does not require a major rewrite.

### 4.3 Tech-stack mapping (consistent with existing ATMS)

- Language: TypeScript (same stack as the Manager).
- DB: `better-sqlite3` (reuse `getDb()`).
- Tests: `vitest` (reuse existing config).
- Model: `@xenova/transformers` (new dependency, Manager side only).
- Wire format: embeddings travel as `Float32Array` in memory and are persisted as `BLOB`.

---

## 5. Architecture

### 5.1 Layering

```
┌─────────────────────────────────────────────────────────────┐
│  Consumers  Manager Agent · Voice Agent · CLI · HTTP API    │
│           (inject recalled fragments after loadMessages)    │
├─────────────────────────────────────────────────────────────┤
│  Retrieval  MemoryRetriever                                 │
│           query → embed → VectorIndex.search(topK) → chunks │
├─────────────────────────────────────────────────────────────┤
│  Index  VectorIndex (interface)                             │
│           ├─ BruteForceIndex  (this phase: in-mem BLOB + cosine)│
│           └─ HnswIndex        (later: USearch/HNSWlib WASM)  │
├─────────────────────────────────────────────────────────────┤
│  Embedding  EmbeddingService (interface)                    │
│           └─ XenovaEmbedder  (@xenova/transformers, local)  │
├─────────────────────────────────────────────────────────────┤
│  Chunking  Chunker                                           │
│           session history / experience → fixed-size + overlap│
├─────────────────────────────────────────────────────────────┤
│  Storage  memory_chunks table (SQLite)                       │
│           id · scope · session_id · content · embedding BLOB │
│           · metadata · created_at                            │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Data flow

**Write (ingest)**
1. Trigger: session `closeSession` / experience pipeline completion / manual `atms memory ingest`.
2. Select content: take **long-term-worthy** text from session history or `experience_nodes`
   (filter pure tool noise, overly short fragments, duplicate content).
3. Redaction: run the existing credential redactor to guarantee no keys.
4. Chunk: the `Chunker` splits into blocks of `size=512` with `overlap=64`.
5. Embed: `EmbeddingService` batch-converts to vectors.
6. Persist: insert into `memory_chunks` (idempotent: same scope + content hash is not duplicated).
7. Index: `VectorIndex` incrementally adds the new vectors.

**Read (retrieve)**
1. Trigger: every turn when the Manager / Voice Agent builds context.
2. Query embed: `EmbeddingService` vectorizes the current query.
3. Recall: `VectorIndex.search(queryVec, topK=5, scope=current session/project)`.
4. Filter: similarity threshold (default cosine ≥ 0.35, configurable) + scope filter.
5. Inject: splice the top-k fragments (with provenance + score) into the system prompt as a
   `<long_term_memory>` block, placed **before** the recent linear context.
6. Feedback: record the recall event (for §8 evaluation).

### 5.3 Relationship to the existing memory layer

RAG **does not replace** `memories` / `experience_*`; it adds a **semantic retrieval surface**:
- Structured exact reads (by `user_id` / `kind`) keep their original path.
- Semantic recall goes through `memory_chunks` (content sources can be session history or
  `experience_nodes`).
- They complement each other: structured = "I know this entry was stored"; RAG = "I know this
  entry is related to the current question".

---

## 6. Data Model

### 6.1 New table `memory_chunks` (new schema migration, id assigned after 30+)

```sql
CREATE TABLE IF NOT EXISTS memory_chunks (
  id            TEXT PRIMARY KEY,          -- content hash, idempotency key
  scope         TEXT NOT NULL,             -- 'session' | 'project' | 'global'
  scope_key     TEXT NOT NULL,             -- session_id / project_id / '*'
  session_id    TEXT,                      -- source session (nullable)
  run_id        TEXT,                      -- source DAG run (nullable)
  source        TEXT NOT NULL,             -- 'session' | 'experience' | 'manual'
  content       TEXT NOT NULL,             -- chunk text (already redacted)
  content_hash  TEXT NOT NULL UNIQUE,      -- dedup
  embedding     BLOB NOT NULL,             -- serialized Float32Array
  dim           INTEGER NOT NULL,          -- vector dimension (for validation)
  metadata      TEXT,                      -- JSON: role, sequence, timestamp...
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_scope ON memory_chunks(scope, scope_key);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_session ON memory_chunks(session_id);
```

### 6.2 Config table `memory_rag_config` (follows the existing `*_config` pattern)

```sql
CREATE TABLE IF NOT EXISTS memory_rag_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),   -- single row
  enabled          INTEGER NOT NULL DEFAULT 0,
  model_id         TEXT NOT NULL DEFAULT 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  dim              INTEGER NOT NULL DEFAULT 384,
  chunk_size       INTEGER NOT NULL DEFAULT 512,
  chunk_overlap    INTEGER NOT NULL DEFAULT 64,
  top_k            INTEGER NOT NULL DEFAULT 5,
  min_score        REAL    NOT NULL DEFAULT 0.35,
  max_chunks       INTEGER NOT NULL DEFAULT 50000,  -- exceeding triggers the §10 evolution
  inject_position  TEXT    NOT NULL DEFAULT 'system_prefix',
  updated_at       TEXT NOT NULL
);
```

> Migrations must be idempotent: `CREATE TABLE IF NOT EXISTS` + an `ON CONFLICT DO NOTHING`
> seed row, and add `memory_chunks` to the `CLEARABLE_TABLES` set (keeping `_clearAllSessions`
> semantics consistent).

---

## 7. Interface Design

### 7.1 TypeScript API (`atms_manager/src/persistence/memory-rag.ts` etc.)

```ts
interface EmbeddingService {
  readonly dim: number;
  embed(texts: string[]): Promise<Float32Array[]>;   // batch
  warmup(): Promise<void>;                            // preload model
}

interface VectorIndex {
  add(id: string, vec: Float32Array): void;
  remove(id: string): void;
  search(query: Float32Array, opts: { topK: number; scope?: string; scopeKey?: string }):
    Array<{ id: string; score: number }>;
  size(): number;
}

interface Chunker {
  chunk(text: string): Array<{ content: string; meta: Record<string, unknown> }>;
}

interface MemoryRetriever {
  ingest(source: IngestSource): Promise<IngestReport>;
  retrieve(query: string, opts: RetrieveOpts): Promise<RecallResult>;
  stats(): Promise<MemoryStats>;
}
```

### 7.2 Injection contract

When the Manager / Voice Agent builds context, call after `loadMessages`:

```ts
const recall = await retriever.retrieve(currentQuery, { scope: sessionScope, topK: cfg.top_k });
if (recall.chunks.length) {
  systemPrompt += `\n<long_term_memory>\n` +
    recall.chunks.map(c => `[${c.score.toFixed(2)}] (source:${c.source}:${c.scopeKey}) ${c.content}`).join("\n") +
    `\n</long_term_memory>`;
}
```

> The injection block **only adds to** the recent linear context; when recall is empty, nothing
> is injected and no empty tag is left behind.

### 7.3 CLI (`atms memory`)

```bash
atms memory warmup                 # preload the embedding model
atms memory ingest --source session --session-id <id>
atms memory search "data pipeline requirements" --top-k 5 --scope project
atms memory stats                  # chunk count, dimension, scope distribution, last write
atms memory reindex                # full index rebuild (required after a model change)
```

### 7.4 HTTP API (follows the `/api/...` style, subject to control-plane auth)

```
GET  /api/memory/search?query=...&top_k=5&scope=project
POST /api/memory/ingest            { source, scope_key }
GET  /api/memory/stats
POST /api/memory/reindex
```

---

## 8. Evaluation (the "evaluation of AI behavior" requirement)

RAG's value must be proven with data, not "it runs, so it works". Reuse ATMS's existing
eval/scorecard approach:

1. **Retrieval quality**: build an annotated set (~30 queries + the chunks they should recall)
   and measure `Recall@5` and `MRR`. Target: relevant chunks hit in top-5 at ≥ 0.8.
2. **End-to-end**: run the same task set with RAG on and off, and compare whether the Manager's
   answers are more accurate and whether "amnesia" (re-asking things already stated) decreases.
3. **Latency**: per-text embed time and top-5 retrieval time (target: retrieval P95 < 100ms
   once the model is warm).
4. **Scale**: a chunk-count vs. retrieval-time curve, confirming brute-force cosine is acceptable
   up to 50k.

> Evaluation reports land in `evals/rag/`, can be referenced via `atms memory stats --eval`,
> and serve as hard, interview-ready evidence.

---

## 9. Security & Privacy

- **Redaction first**: any content entering `memory_chunks` passes the existing shared redactor
  (same trust boundary as the activity plane) to guarantee no API keys / tokens / passwords.
- **No credential storage**: neither `embedding` nor `content` may contain keys; `metadata` is
  size-bounded.
- **Scope isolation**: retrieval is limited to the current session/project scope by default;
  `global` must be explicitly enabled.
- **Deletable**: `atms memory purge --scope ...` supports scope-based cleanup; `memory_chunks`
  is added to `CLEARABLE_TABLES` to be included in unified clearing.
- **Local model**: embedding weights are cached under `ATMS_HOME`; no content is uploaded anywhere.

---

## 10. Evolution Path (not in this phase; hooks reserved)

| Phase | Trigger | Action |
| --- | --- | --- |
| Current | < 50k chunks | Brute-force cosine + in-memory BLOB |
| Next | > 50k chunks or retrieval P95 exceeded | Swap `VectorIndex` to USearch/HNSWlib (WASM); SQLite remains the persistence layer |
| Later | Stronger Chinese / multimodal needed | Switch to `bge-m3`, or run a local TEI service (still local) |
| Optional | Graph semantics needed | Combine `experience_relationships` for 1-hop graph RAG |

The interface layer (`VectorIndex` / `EmbeddingService`) already reserves abstractions for these
evolutions; swapping implementations does not touch the consumers.

---

## 11. Implementation Steps (dependency-ordered)

1. **Selection benchmark**: fetch candidate models, run the §4.1 Chinese/English benchmark,
   and fix the final `model_id`.
2. **Migration**: a new `schema_migrations` version creating `memory_chunks` +
   `memory_rag_config`, added to `CLEARABLE_TABLES`, with idempotency tests.
3. **EmbeddingService**: a `@xenova/transformers` wrapper with batch embed + warmup + model
   caching, and unit tests (fixed text → fixed dimension, similarity direction correct).
4. **Chunker**: fixed-size + overlap splitting, unit tests (boundaries, empty string, over-long,
   Chinese split by character not by word).
5. **VectorIndex (BruteForce)**: in-memory BLOB + cosine, unit tests (top-k ordering, scope
   filtering, add/remove).
6. **MemoryRetriever**: ingest (redact → chunk → embed → persist → index) + retrieve, unit tests
   (idempotency, dedup, threshold).
7. **Injection**: the Manager / Voice Agent injects `<long_term_memory>` after `loadMessages`,
   with an integration test (context difference with RAG on/off).
8. **CLI + HTTP**: `atms memory *` and `/api/memory/*`, under existing auth constraints.
9. **Evaluation**: build the annotated set, run the §8 metrics, produce the report.
10. **Docs**: update the Feature List in `README.md` (add "Long-Term RAG Memory") + add
    `docs/rag-memory.md`.

> Every step starts with a vitest (TDD), then implements, ensuring the 376 existing tests stay
> green.

---

## 12. Acceptance Criteria (Definition of Done)

- [ ] `memory_chunks` / `memory_rag_config` migrations are idempotent; old DBs upgrade smoothly.
- [ ] `EmbeddingService` runs locally; Chinese/English samples embed to the correct dimension and
      similar texts score higher by cosine.
- [ ] `MemoryRetriever.retrieve` achieves Recall@5 ≥ 0.8 on the annotated set.
- [ ] With RAG on, the Manager / Voice Agent recall earlier relevant information in long sessions
      (proven by an integration test).
- [ ] 100% of stored content passes redaction (a test injects a key-bearing sample and verifies
      it is not stored).
- [ ] `atms memory search/ingest/stats/reindex` all work.
- [ ] All 376 existing tests stay green; new tests cover chunking / embedding / retrieval /
      injection / redaction / migration.
- [ ] `docs/rag-memory.md` + README updated, including real evaluation data.

---
