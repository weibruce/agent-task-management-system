/**
 * Session RAG ingest: when a Manager chat session is closed, ingest its
 * messages into the long-term memory store (if RAG is enabled).
 *
 * Runs fire-and-forget with a hard timeout so a slow model download or a
 * stuck embedding call can never hang the closeSession HTTP response.
 * All failures are swallowed: memory ingestion is best-effort and must
 * never break session lifecycle.
 */

import { loadMessages } from "../persistence/agent-sessions.js";
import { readRagConfig } from "./memory-retriever.js";
import { getRagRuntime } from "./runtime.js";

const INGEST_TIMEOUT_MS = 30_000;

/**
 * Ingest all messages of a session into the RAG store.
 * Resolves with the number of messages ingested (0 when RAG is disabled
 * or ingestion fails). Never throws.
 */
export async function ingestSessionMessages(sessionId: string): Promise<number> {
  let total = 0;
  try {
    const config = readRagConfig();
    if (!config.enabled) return 0;
    const messages = loadMessages(sessionId);
    const { retriever } = await getRagRuntime();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("session RAG ingest timed out")), INGEST_TIMEOUT_MS).unref(),
    );
    const work = (async () => {
      for (const message of messages) {
        if (message.role !== "user" && message.role !== "assistant") continue;
        const content = message.content.trim();
        if (!content) continue;
        const result = await retriever.ingestSessionMessage({
          sessionId,
          role: message.role,
          content,
          runId: message.run_id,
        });
        total += result.ingested;
      }
      return total;
    })();
    return await Promise.race([work, timeout]);
  } catch {
    return total;
  }
}
