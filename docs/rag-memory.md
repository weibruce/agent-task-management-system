# RAG Long-Term Memory

Local RAG (Retrieval-Augmented Generation) long-term memory for the Manager/Voice Agent. Session content is embedded by a **local multilingual model**, stored in SQLite, and injected as context on every agent turn — so the agent remembers relevant past conversations without sending anything to a third-party embedding API.

Requirements and design rationale: [rag-memory-requirements.md](rag-memory-requirements.md) / [rag-memory-requirements.zh-CN.md](rag-memory-requirements.zh-CN.md).

## Components

| Part | Where | Role |
| --- | --- | --- |
| Embedding service | `atms_manager/src/rag/embedding-service.ts` | `@xenova/transformers` feature-extraction pipeline, `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (384-dim, selected by `scripts/rag-model-benchmark.ts`). Model weights are cached under `~/.atms/rag-models` (override: `RAG_MODEL_CACHE`). |
| Chunker | `atms_manager/src/rag/chunker.ts` | Character-based fixed-size + overlap (CJK-safe, no segmentation). Defaults 320/64, configurable. |
| Vector index | `atms_manager/src/rag/vector-index.ts` | In-memory `BruteForceIndex` (cosine, `Float32Array`). `sqlite-vec` is deferred to a later iteration. |
| Retriever | `atms_manager/src/rag/memory-retriever.ts` | Redaction → chunking → embedding → storage; scoped cosine search. |
| Injection | `atms_manager/src/rag/memory-injection.ts`, wired in `src/server/manager-agent-runtime.ts` | Wraps the user message with retrieved chunks at the start of every Manager/Voice Agent turn. Degrades to the original message on any failure. |
| Session ingest | `atms_manager/src/rag/session-ingest.ts` | Fire-and-forget ingest on `POST /api/manager/sessions/:id/close`, hard timeout, best-effort (never breaks session lifecycle). |
| Config | `memory_rag_config` table (migration v38) | Single-row settings: `enabled`, `model_id`, `dim`, `chunk_size`, `chunk_overlap`, `top_k`, `min_score`, `max_chunks`, `inject_position`. Default `enabled=0`. |

Data model: `memory_chunks(id, scope, scope_key, session_id, run_id, source, content, content_hash, embedding, dim, metadata, …)`. Every chunk passes through `atms-protocol`'s `redactTelemetry` before storage — nothing sensitive reaches the DB or the prompt.

## Scope model

Each chunk carries `(scope, scope_key)`:

- `session` → `scope_key = session_id` (ingested on session close)
- `project` → `scope_key = project_id`
- `global` → `scope_key = *`

Retrieval for a `(sessionId, projectId?)` context returns the union of that session's chunks + project chunks + global chunks. Scope filtering happens after cosine search so `top_k` applies to the *visible* set, not the whole corpus.

## HTTP API (`/api/memory/rag/*`)

Mounted in `atms_manager/src/server/memory-rag.ts` (chained before the legacy `/api/memory/*` structured-memory routes; they do not conflict).

| Method & path | Purpose |
| --- | --- |
| `GET /api/memory/rag/status` | Config + chunk counts (by scope) + last ingest time. No model load. |
| `GET /api/memory/rag/search?query=...&top_k=5&min_score=0&session_id=...&project_id=...` | Scoped cosine search. |
| `POST /api/memory/rag/ingest` `{"source":"session","session_id":"..."}` | Ingest a session's messages (404 if the session is unknown). |
| `POST /api/memory/rag/ingest` `{"source":"manual","content":"...","scope":"global\|project\|session","scope_key":"...","metadata":{}}` | Ingest an experience/manual memory item. |
| `POST /api/memory/rag/clear?scope=session\|project\|global\|all&scope_key=...` | Delete chunks by scope. `scope=all` clears everything. |

## CLI (`atms memory ...`)

Implemented in `atms_cli/src/commands/memory.ts`, calls the HTTP API above:

```bash
atms memory status                          # config + chunk stats
atms memory search "查询" [--top-k 5] [--session-id <id>] [--project-id <id>]
atms memory ingest session <session_id>     # ingest a session's messages
atms memory ingest manual --content "..." [--scope global|project|session] [--scope-key <id>]
atms memory clear [session|project|global|all] [--scope-key <id>]
```

All commands accept the global `--base-url` and `--json` flags.

## Ingestion & injection flow

1. **Ingest** — when a session is closed (`/api/manager/sessions/:id/close`), `ingestSessionMessages` loads the session's user/assistant messages, redacts, chunks, embeds, and stores them under scope `session`. Runs in the background with a 60 s hard timeout; failures are logged and swallowed.
2. **Inject** — at the start of every Manager/Voice Agent turn, `messageWithMemory` retrieves the top-k visible chunks for the current message and wraps the user message with a `## 长期记忆检索结果` block (each entry: score + provenance + content). Any retrieval failure leaves the original message untouched.

## Enabling

RAG is **off by default**. Enable it (and tune it) via the config row:

```sql
UPDATE memory_rag_config SET enabled = 1 WHERE id = 1;
-- optional tuning
UPDATE memory_rag_config SET top_k = 5, min_score = 0.2, chunk_size = 320 WHERE id = 1;
```

The first ingest/search triggers a one-time model download (~90 MB) into the cache; warm embedding latency is ~15 ms median (benchmark).

## Evaluation

A labeled query→relevant-content set (14 entries, Chinese + English) lives in `atms_manager/evals/rag-eval-set.json`, with a vitest harness computing **Recall@5 / MRR**:

```bash
cd atms_manager
npm run eval:rag                      # mock embedder (fast, offline, CI-safe)
RAG_EVAL_REAL=1 npm run eval:rag      # real model (~1 min)
```

Report is written to `atms_manager/evals/rag-eval-report.txt`. Latest results: mock `Recall@5=1.000 MRR=0.964`; real model `Recall@5=1.000 MRR=1.000`.

## Tests

- `tests/memory-rag-migration.test.ts` — migration v38 schema + config seed.
- `tests/rag-chunker.test.ts` — CJK-safe chunking, overlap, boundaries.
- `tests/rag-vector-index.test.ts` — cosine search, add/remove, dim checks.
- `tests/rag-embedding-service.test.ts` — mock embedder + service cache.
- `tests/rag-memory-retriever.test.ts` — redact/chunk/embed/store/retrieve + scope visibility.
- `tests/rag-memory-injection.test.ts` — injection block formatting + graceful degradation.
- `tests/rag-session-ingest.test.ts` — session-close ingest (enabled/disabled/best-effort).
- `tests/memory-rag-routes.test.ts` — HTTP API routes (status/search/ingest/clear, 400/404 paths).
- `tests/memory-rag-delete.test.ts` — deletion API (session/project/global/all).
- `evals/rag-eval.test.ts` — Recall@5 / MRR evaluation.

## Evolution notes

- `sqlite-vec` (persistent vector index) is planned next; the in-memory index is a deliberate early simplification.
- Per-project scopes are stored and filterable now; project-scoped ingestion entry points can be added without schema changes.
