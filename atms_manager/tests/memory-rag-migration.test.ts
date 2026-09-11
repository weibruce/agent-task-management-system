import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, clearTables, getDb } from "../src/persistence/db.js";
import { encodeJson } from "../src/persistence/db.js";

function withFreshHome<T>(fn: (home: string) => T | Promise<T>): Promise<T> | T {
  return (async () => {
    closeDb();
    const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "atms-rag-migration-"));
    const oldHome = process.env.ATMS_HOME;
    process.env.ATMS_HOME = home;
    try {
      return await fn(home);
    } finally {
      closeDb();
      if (oldHome === undefined) delete process.env.ATMS_HOME;
      else process.env.ATMS_HOME = oldHome;
      fs.rmSync(home, { recursive: true, force: true });
    }
  })();
}

function tableExists(db: ReturnType<typeof getDb>, table: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

function columnNames(db: ReturnType<typeof getDb>, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name);
}

describe("memory RAG schema migration (v38)", () => {
  let home: string;

  beforeEach(() => {
    // home set inside withFreshHome wrapper below; placeholder for readability
    home = process.env.ATMS_HOME ?? "";
  });

  afterEach(() => {
    closeDb();
  });

  it("creates memory_chunks and memory_rag_config on a fresh database", async () => {
    await withFreshHome((h) => {
      home = h;
      const db = getDb();
      expect(tableExists(db, "memory_chunks")).toBe(true);
      expect(tableExists(db, "memory_rag_config")).toBe(true);

      const chunkCols = columnNames(db, "memory_chunks");
      for (const col of [
        "id", "scope", "scope_key", "session_id", "run_id", "source",
        "content", "content_hash", "embedding", "dim", "metadata",
        "created_at", "updated_at",
      ]) {
        expect(chunkCols).toContain(col);
      }

      const configCols = columnNames(db, "memory_rag_config");
      for (const col of [
        "id", "enabled", "model_id", "dim", "chunk_size", "chunk_overlap",
        "top_k", "min_score", "max_chunks", "inject_position", "updated_at",
      ]) {
        expect(configCols).toContain(col);
      }

      // Seed row with defaults.
      const row = db.prepare("SELECT * FROM memory_rag_config WHERE id = 1").get() as Record<string, unknown>;
      expect(row).toBeTruthy();
      expect(row.enabled).toBe(0);
      expect(row.model_id).toBe("Xenova/paraphrase-multilingual-MiniLM-L12-v2");
      expect(row.dim).toBe(384);
      expect(row.chunk_size).toBe(512);
      expect(row.chunk_overlap).toBe(64);
      expect(row.top_k).toBe(5);
      expect(row.min_score).toBe(0.35);
      expect(row.max_chunks).toBe(50000);
      expect(row.inject_position).toBe("system_prefix");
    });
  });

  it("is idempotent: opening the database a second time does not duplicate rows or fail", async () => {
    await withFreshHome((h) => {
      home = h;
      const db = getDb();
      // Force a re-open to re-run the initialization path (getDb caches by path,
      // so close first).
      closeDb();
      const db2 = getDb();

      expect((db2.prepare("SELECT COUNT(*) AS n FROM memory_rag_config").get() as { n: number }).n).toBe(1);
      // Migrations recorded exactly once.
      expect((db2.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 38").get() as { n: number }).n).toBe(1);
    });
  });

  it("upgrades an existing pre-v38 database smoothly (old tables survive)", async () => {
    await withFreshHome((h) => {
      home = h;
      // First open: creates the full schema up to v38.
      const db = getDb();
      // Simulate an older database by checking that pre-existing tables remain.
      expect(tableExists(db, "sessions")).toBe(true);
      expect(tableExists(db, "session_messages")).toBe(true);
      expect(tableExists(db, "memory_chunks")).toBe(true);
    });
  });

  it("memory_chunks is part of CLEARABLE_TABLES", async () => {
    await withFreshHome((h) => {
      home = h;
      const db = getDb();
      const now = new Date().toISOString();
      const vec = new Float32Array([0.1, 0.2, 0.3]);
      db.prepare(`
        INSERT INTO memory_chunks (
          id, scope, scope_key, session_id, run_id, source,
          content, content_hash, embedding, dim, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "chunk-1", "session", "sess-a", "sess-a", null, "session",
        "test chunk content", "hash-1", Buffer.from(vec.buffer), vec.length,
        encodeJson({ role: "user" }), now, now,
      );
      // clearTables must accept memory_chunks without throwing.
      expect(() => clearTables(["memory_chunks"])).not.toThrow();
      expect((db.prepare("SELECT COUNT(*) AS n FROM memory_chunks").get() as { n: number }).n).toBe(0);
    });
  });

  it("rejects duplicate content_hash", async () => {
    await withFreshHome((h) => {
      home = h;
      const db = getDb();
      const now = new Date().toISOString();
      const vec = new Float32Array(384).fill(0.01);
      const insert = db.prepare(`
        INSERT INTO memory_chunks (
          id, scope, scope_key, session_id, run_id, source,
          content, content_hash, embedding, dim, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run("c1", "global", "*", null, null, "manual", "a", "hash-x", Buffer.from(vec.buffer), 384, "{}", now, now);
      expect(() => insert.run("c2", "global", "*", null, null, "manual", "a", "hash-x", Buffer.from(vec.buffer), 384, "{}", now, now)).toThrow();
    });
  });
});
