import type { Command } from "commander";
import { getClient, type BaseResponse } from "../index.js";

interface GlobalOpts {
  baseUrl?: string;
  json?: boolean;
  requestTimeout?: number;
}

interface MemoryStatusData {
  enabled: boolean;
  model_id: string;
  dim: number;
  chunk_size: number;
  chunk_overlap: number;
  top_k: number;
  min_score: number;
  max_chunks: number;
  total_chunks: number;
  by_scope: Record<string, number>;
  last_ingest: string | null;
}

interface MemorySearchResult {
  id: string;
  scope: string;
  scope_key: string;
  session_id: string | null;
  source: string;
  content: string;
  score: number;
  created_at: string;
}

interface MemoryIngestData {
  session_id?: string;
  ingested: number;
  skipped?: number;
}

interface MemoryClearData {
  deleted: number;
}

interface MemoryResponse extends BaseResponse {
  data?: MemoryStatusData & {
    query?: string;
    count?: number;
    results?: MemorySearchResult[];
  } & Partial<MemoryIngestData> & Partial<MemoryClearData>;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function output(globalOpts: GlobalOpts, value: unknown): void {
  console.log(JSON.stringify(value, null, globalOpts.json ? 2 : 0));
}

function printStatus(data: MemoryStatusData): void {
  console.log(`RAG memory: ${data.enabled ? "enabled" : "disabled"}`);
  console.log(`Model: ${data.model_id} (dim ${data.dim})`);
  console.log(`Chunks: ${data.total_chunks} total (limit ${data.max_chunks})`);
  for (const [scope, n] of Object.entries(data.by_scope)) {
    console.log(`  ${scope}: ${n}`);
  }
  console.log(`Retrieval: top_k=${data.top_k} min_score=${data.min_score} chunk=${data.chunk_size}+${data.chunk_overlap}`);
  console.log(`Last ingest: ${data.last_ingest ?? "never"}`);
}

function printResults(results: MemorySearchResult[]): void {
  if (results.length === 0) {
    console.log("No matching memories.");
    return;
  }
  for (const r of results) {
    console.log(`[${r.score.toFixed(3)}] (${r.scope} ${r.scope_key}, ${r.source}) ${r.content}`);
  }
}

export function registerMemoryCommand(program: Command): void {
  const memory = program.command("memory").description("Manage long-term RAG memory");

  memory
    .command("status")
    .description("Show RAG memory status (model, config, chunk counts)")
    .action(async () => {
      const globalOpts = program.opts<GlobalOpts>();
      const response = await getClient(globalOpts).get<MemoryResponse>("/api/memory/rag/status");
      if (globalOpts.json) output(globalOpts, response);
      else if (response.data) printStatus(response.data as MemoryStatusData);
    });

  memory
    .command("search <query...>")
    .description("Semantic search over long-term memory")
    .option("--session <id>", "Restrict to one session's chunks (plus global)")
    .option("--project <id>", "Include one project's chunks")
    .option("--top <n>", "Max results (default: server top_k)", (v) => {
      const n = Number.parseInt(v, 10);
      if (!Number.isInteger(n) || n <= 0) throw new Error("--top must be a positive integer");
      return n;
    })
    .option("--min-score <f>", "Minimum cosine score", (v) => {
      const f = Number.parseFloat(v);
      if (Number.isNaN(f)) throw new Error("--min-score must be a number");
      return f;
    })
    .action(async (queryParts: string[], opts: {
      session?: string;
      project?: string;
      top?: number;
      minScore?: number;
    }) => {
      const globalOpts = program.opts<GlobalOpts>();
      const query = queryParts.join(" ");
      const params = new URLSearchParams({ query });
      if (opts.session) params.set("session_id", opts.session);
      if (opts.project) params.set("project_id", opts.project);
      if (opts.top !== undefined) params.set("top_k", String(opts.top));
      if (opts.minScore !== undefined) params.set("min_score", String(opts.minScore));
      const response = await getClient(globalOpts).get<MemoryResponse>(`/api/memory/rag/search?${params.toString()}`);
      if (globalOpts.json) output(globalOpts, response);
      else printResults(response.data?.results ?? []);
    });

  memory
    .command("ingest")
    .description("Ingest content into long-term memory")
    .option("--session <id>", "Ingest all messages of an existing Manager session")
    .option("--scope <scope>", "Scope for manual content: global, project, or session (default: global)")
    .option("--scope-key <key>", "Scope key (project_id or session_id; default: '*' for global)")
    .option("--text <content>", "Manual content to store (or pipe via stdin)")
    .action(async (opts: { session?: string; scope?: string; scopeKey?: string; text?: string }) => {
      const globalOpts = program.opts<GlobalOpts>();
      if (opts.session) {
        const response = await getClient(globalOpts).post<MemoryResponse>("/api/memory/rag/ingest", {
          source: "session",
          session_id: opts.session,
        });
        if (globalOpts.json) output(globalOpts, response);
        else console.log(`Ingested ${response.data?.ingested ?? 0} chunks from session ${opts.session}.`);
        return;
      }
      let content = opts.text?.trim();
      if (!content) {
        const stdin = (await readStdin()).trim();
        if (!stdin) throw new Error("No content: use --text or pipe content via stdin");
        content = stdin;
      }
      const scope = opts.scope ?? "global";
      if (!["global", "project", "session"].includes(scope)) {
        throw new Error("--scope must be 'global', 'project', or 'session'");
      }
      const response = await getClient(globalOpts).post<MemoryResponse>("/api/memory/rag/ingest", {
        source: "manual",
        content,
        scope,
        scope_key: opts.scopeKey,
      });
      if (globalOpts.json) output(globalOpts, response);
      else console.log(`Ingested ${response.data?.ingested ?? 0} chunk(s) (skipped ${response.data?.skipped ?? 0}).`);
    });

  memory
    .command("clear")
    .description("Delete stored memory chunks")
    .option("--session <id>", "Delete one session's chunks")
    .option("--project <id>", "Delete one project's chunks")
    .option("--scope <scope>", "Delete an entire scope (global or project)")
    .option("--all", "Delete every chunk")
    .action(async (opts: { session?: string; project?: string; scope?: string; all?: boolean }) => {
      const globalOpts = program.opts<GlobalOpts>();
      const flags = [Boolean(opts.session), Boolean(opts.project), Boolean(opts.scope), Boolean(opts.all)]
        .filter(Boolean).length;
      if (flags === 0) throw new Error("Specify one of --session <id>, --project <id>, --scope <global|project>, or --all");
      if (flags > 1) throw new Error("Use only one of --session, --project, --scope, or --all");
      let scope: string;
      let scopeKey: string | undefined;
      if (opts.session) {
        scope = "session";
        scopeKey = opts.session;
      } else if (opts.project) {
        scope = "project";
        scopeKey = opts.project;
      } else if (opts.scope) {
        if (!["global", "project"].includes(opts.scope)) {
          throw new Error("--scope must be 'global' or 'project' (use --session/--project for a single key)");
        }
        scope = opts.scope;
      } else {
        scope = "all";
      }
      const params = new URLSearchParams({ scope });
      if (scopeKey) params.set("scope_key", scopeKey);
      const response = await getClient(globalOpts).post<MemoryResponse>(`/api/memory/rag/clear?${params.toString()}`, {});
      if (globalOpts.json) output(globalOpts, response);
      else console.log(`Deleted ${response.data?.deleted ?? 0} chunk(s).`);
    });
}
