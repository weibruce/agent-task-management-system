/**
 * RAG memory HTTP API routes (/api/memory/rag/*).
 *
 * Separate from the legacy structured-memory routes in memory.ts
 * (/api/memory/memories, /api/memory/stats) — this handler only matches the
 * /api/memory/rag prefix and returns false otherwise, so it can be chained
 * before the legacy handler without route conflicts.
 */
import * as http from "node:http";

import { getDb } from "../persistence/db.js";
import { loadSession } from "../persistence/agent-sessions.js";
import { readRagConfig } from "../rag/memory-retriever.js";
import { getRagRuntime } from "../rag/runtime.js";
import { ingestSessionMessages } from "../rag/session-ingest.js";

interface BaseResponse {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
}

function json(res: http.ServerResponse, status: number, body: BaseResponse): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function ok(res: http.ServerResponse, message: string, data?: unknown): void {
  json(res, 200, { success: true, message, data });
}

function badRequest(res: http.ServerResponse, message: string): void {
  json(res, 400, { success: false, message, error: message });
}

function notFound(res: http.ServerResponse, message: string): void {
  json(res, 404, { success: false, message, error: message });
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (chunks.reduce((sum, c) => sum + c.length, 0) > 1024 * 1024) {
      throw new Error("body too large");
    }
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

async function handleIngest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    badRequest(res, err instanceof Error ? err.message : "invalid JSON body");
    return;
  }
  const source = body.source;
  if (source === "session") {
    const sessionId = typeof body.session_id === "string" ? body.session_id : "";
    if (!loadSession(sessionId)) {
      notFound(res, `Session not found: ${sessionId}`);
      return;
    }
    const ingested = await ingestSessionMessages(sessionId);
    ok(res, "Session ingested into RAG memory", { session_id: sessionId, ingested });
    return;
  }
  if (source === "manual") {
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) {
      badRequest(res, "Missing required field: content");
      return;
    }
    const scope = (body.scope === "project" || body.scope === "session") ? body.scope : "global";
    const scopeKey = typeof body.scope_key === "string" && body.scope_key.trim()
      ? body.scope_key.trim()
      : (scope === "global" ? "*" : content.slice(0, 64));
    const { retriever } = await getRagRuntime();
    const result = await retriever.ingestExperience({
      scope,
      scopeKey,
      content,
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata as Record<string, unknown> : {},
    });
    ok(res, "Manual memory ingested", { ingested: result.ingested, skipped: result.skipped });
    return;
  }
  badRequest(res, "source must be 'session' or 'manual'");
}

async function handleSearch(url: URL, res: http.ServerResponse): Promise<void> {
  const query = url.searchParams.get("query")?.trim() ?? "";
  if (!query) {
    badRequest(res, "Missing required field: query");
    return;
  }
  const topK = url.searchParams.get("top_k")
    ? Number.parseInt(url.searchParams.get("top_k")!, 10)
    : undefined;
  const minScore = url.searchParams.get("min_score")
    ? Number.parseFloat(url.searchParams.get("min_score")!)
    : undefined;
  const sessionId = url.searchParams.get("session_id") ?? undefined;
  const projectId = url.searchParams.get("project_id") ?? undefined;

  const { retriever } = await getRagRuntime();
  const results = await retriever.retrieveSessionMemory({
    query,
    topK: topK && Number.isFinite(topK) && topK > 0 ? topK : undefined,
    minScore: minScore && Number.isFinite(minScore) ? minScore : undefined,
    sessionId,
    projectId,
  });
  ok(res, "RAG search complete", {
    query,
    count: results.length,
    results: results.map((r) => ({
      id: r.id,
      scope: r.scope,
      scope_key: r.scopeKey,
      session_id: r.sessionId,
      source: r.source,
      content: r.content,
      score: Number(r.score.toFixed(4)),
      created_at: r.createdAt,
    })),
  });
}

function handleStatus(res: http.ServerResponse): void {
  const config = readRagConfig();
  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) AS n FROM memory_chunks").get() as { n: number }).n;
  const byScopeRows = db.prepare("SELECT scope, COUNT(*) AS n FROM memory_chunks GROUP BY scope").all() as Array<{ scope: string; n: number }>;
  const byScope: Record<string, number> = {};
  for (const row of byScopeRows) byScope[row.scope] = row.n;
  const latest = db.prepare("SELECT created_at FROM memory_chunks ORDER BY created_at DESC, id DESC LIMIT 1").get() as { created_at: string } | undefined;
  ok(res, "RAG memory status", {
    enabled: config.enabled,
    model_id: config.modelId,
    dim: config.dim,
    chunk_size: config.chunkSize,
    chunk_overlap: config.chunkOverlap,
    top_k: config.topK,
    min_score: config.minScore,
    max_chunks: config.maxChunks,
    total_chunks: total,
    by_scope: byScope,
    last_ingest: latest?.created_at ?? null,
  });
}

async function handleClear(url: URL, res: http.ServerResponse): Promise<void> {
  const { retriever } = await getRagRuntime();
  const scope = url.searchParams.get("scope");
  const scopeKey = url.searchParams.get("scope_key");
  let deleted = 0;
  if (scope === "session") {
    if (!scopeKey) {
      badRequest(res, "scope_key (session_id) is required for scope=session");
      return;
    }
    deleted = retriever.deleteSessionMemory(scopeKey);
  } else if (scope === "project" || scope === "global") {
    deleted = retriever.deleteMemory(scope, scopeKey ?? undefined);
  } else if (scope === "all") {
    deleted = retriever.clearAllMemory();
  } else {
    badRequest(res, "scope must be 'session', 'project', 'global', or 'all'");
    return;
  }
  ok(res, "RAG memory cleared", { deleted });
}

export function memoryRagRoutesHandler(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const url = new URL(req.url || "/", "http://localhost");
  const pathname = url.pathname.replace(/\/$/, "");

  if (!pathname.startsWith("/api/memory/rag")) return false;

  if (pathname === "/api/memory/rag/status" && req.method === "GET") {
    handleStatus(res);
    return true;
  }

  if (pathname === "/api/memory/rag/search" && req.method === "GET") {
    handleSearch(url, res).catch((err) => {
      json(res, 500, { success: false, message: err instanceof Error ? err.message : "RAG search failed" });
    });
    return true;
  }

  if (pathname === "/api/memory/rag/ingest" && req.method === "POST") {
    handleIngest(req, res).catch((err) => {
      json(res, 500, { success: false, message: err instanceof Error ? err.message : "RAG ingest failed" });
    });
    return true;
  }

  if (pathname === "/api/memory/rag/clear" && req.method === "POST") {
    handleClear(url, res).catch((err) => {
      json(res, 500, { success: false, message: err instanceof Error ? err.message : "RAG clear failed" });
    });
    return true;
  }

  notFound(res, `Unknown RAG memory route: ${req.method} ${pathname}`);
  return true;
}
