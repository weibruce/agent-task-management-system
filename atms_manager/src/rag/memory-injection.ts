/**
 * buildMemoryInjection: the seam between the RAG retriever and the Manager
 * Agent prompt. Called at the start of every Manager/Voice Agent turn, after
 * session history is loaded, to prepend a bounded "long-term memory" block to
 * the user message when RAG is enabled and relevant chunks exist.
 *
 * Design constraints (from docs/rag-memory-requirements.md):
 *   - Injection is a NO-OP when RAG is disabled, when no session is bound,
 *     or when retrieval returns nothing above min_score.
 *   - The block carries provenance (scope + score) so the LLM can weight it.
 *   - The original user message is preserved verbatim at the end.
 */

import type { MemoryRetriever } from "./memory-retriever.js";

export interface MemoryInjectionParams {
  sessionId?: string;
  projectId?: string;
  /** The query to retrieve against (usually the user message). */
  query: string;
  /** The user message to wrap. */
  userMessage: string;
}

/**
 * Build the injection block. Returns `userMessage` unchanged when there is
 * nothing to inject; otherwise returns:
 *
 *   <atms_long_term_memory>
 *   ...numbered chunks with provenance...
 *   </atms_long_term_memory>
 *
 *   {userMessage}
 */
export async function buildMemoryInjection(
  retriever: MemoryRetriever,
  params: MemoryInjectionParams,
): Promise<string> {
  // No session → no scope → nothing visible (project/global chunks are
  // out of scope for the initial implementation).
  if (!params.sessionId) return params.userMessage;
  const query = params.query.trim();
  if (!query) return params.userMessage;

  let context: string;
  try {
    context = await retriever.buildMemoryContext({
      sessionId: params.sessionId,
      projectId: params.projectId,
      query,
    });
  } catch {
    // Retrieval must never break the turn. If the embedding model is not
    // ready or the DB is unavailable, degrade to no injection.
    return params.userMessage;
  }
  if (!context) return params.userMessage;

  return [
    "<atms_long_term_memory>",
    context,
    "</atms_long_term_memory>",
    "",
    params.userMessage,
  ].join("\n");
}
