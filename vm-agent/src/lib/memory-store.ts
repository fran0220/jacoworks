/**
 * SQLite + FTS5 Memory Store
 *
 * Cloud container architecture:
 * - BM25 via FTS5 (unicode61 + CJK character segmentation, <10ms)
 * - Optional vector reranking on BM25 candidate set
 * - Embedding cached in SQLite with LRU eviction
 * - WAL mode for concurrent reads
 *
 * CJK handling: spaces inserted around each CJK character before FTS
 * indexing/querying so unicode61 tokenizes them individually.
 *
 * Migration: vectors.json → memory.db (one-time on startup)
 */

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  embed,
  embedBatch,
  cosineSimilarity,
  isEmbeddingAvailable,
  type Embedding,
} from "./embedding.js";

// ─── Types ──────────────────────────────────────────

export interface MemoryStoreConfig {
  embedCacheMax: number;
  hybridWBm25: number;
  hybridWVec: number;
}

export interface SearchResult {
  text: string;
  source: string;
  score: number;
}

export interface HybridSearchOptions {
  decayWindowDays?: number;
}

interface BM25Row {
  hash: string;
  text: string;
  source: string;
  timestamp: number;
  rank: number;
}

interface ScoredCandidate extends SearchResult {
  timestamp: number;
}

const MS_PER_DAY = 86_400_000;
const DEFAULT_DECAY_WINDOW_DAYS = 30;

// ─── Helpers ────────────────────────────────────────

/** Insert spaces around CJK characters for unicode61 tokenization */
function cjkSegment(text: string): string {
  return text.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, " $& ");
}

function embeddingToBlob(emb: Embedding): Uint8Array {
  return new Uint8Array(new Float32Array(emb).buffer);
}

function blobToEmbedding(blob: Uint8Array): number[] {
  const aligned = new ArrayBuffer(blob.byteLength);
  new Uint8Array(aligned).set(blob);
  return Array.from(new Float32Array(aligned));
}

export function jaccardSimilarity(a: string, b: string): number {
  const tokensA = new Set(
    cjkSegment(a)
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean),
  );
  const tokensB = new Set(
    cjkSegment(b)
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean),
  );

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── MemoryStore ────────────────────────────────────

export class MemoryStore {
  private db: Database;
  private config: MemoryStoreConfig;

  constructor(memoryRootDir: string, config: MemoryStoreConfig) {
    mkdirSync(memoryRootDir, { recursive: true });
    this.db = new Database(join(memoryRootDir, "memory.db"));
    this.config = config;
    this.initSchema();
  }

  private initSchema() {
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA cache_size = -2000");
    this.db.exec("PRAGMA temp_store = MEMORY");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL UNIQUE,
        text TEXT NOT NULL,
        source TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);

    // Standalone FTS5 table (no content= external table).
    // CJK-segmented text is inserted manually so unicode61 tokenizes
    // each CJK character individually.
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        text, source, tokenize='unicode61'
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embedding_cache (
        hash TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        used_at INTEGER NOT NULL
      )
    `);
  }

  get size(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM chunks").get() as {
      cnt: number;
    };
    return row.cnt;
  }

  static contentHash(text: string): string {
    return createHash("sha256").update(text).digest("hex").slice(0, 16);
  }

  /** Upsert chunks — skip existing by content hash */
  upsert(items: Array<{ text: string; source: string }>): number {
    if (items.length === 0) return 0;
    const insertChunk = this.db.prepare(
      "INSERT OR IGNORE INTO chunks (hash, text, source, timestamp) VALUES (?, ?, ?, ?)",
    );
    const insertFts = this.db.prepare(
      "INSERT INTO chunks_fts (rowid, text, source) VALUES (?, ?, ?)",
    );
    const now = Date.now();
    let inserted = 0;
    const tx = this.db.transaction(() => {
      for (const item of items) {
        if (item.text.trim().length < 10) continue;
        const hash = MemoryStore.contentHash(item.text);
        const result = insertChunk.run(hash, item.text, item.source, now);
        if (result.changes > 0) {
          insertFts.run(
            result.lastInsertRowid,
            cjkSegment(item.text),
            item.source,
          );
          inserted++;
        }
      }
    });
    tx();
    return inserted;
  }

  /** Remove all chunks for a source (call before re-indexing) */
  removeBySource(source: string): number {
    const tx = this.db.transaction(() => {
      // Delete from FTS first (subquery reads chunks before they're removed)
      this.db
        .prepare(
          "DELETE FROM chunks_fts WHERE rowid IN (SELECT rowid FROM chunks WHERE source = ?)",
        )
        .run(source);
      return this.db
        .prepare("DELETE FROM chunks WHERE source = ?")
        .run(source).changes;
    });
    return tx();
  }

  /** BM25 search via FTS5 — pure local, <10ms */
  searchBm25(query: string, limit = 200): BM25Row[] {
    const sanitized = cjkSegment(query)
      .replace(/['"*(){}[\]^~:+\-!]/g, " ")
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 0 &&
          !["AND", "OR", "NOT", "NEAR"].includes(w.toUpperCase()),
      )
      .join(" ");
    if (!sanitized) return [];

    const sql = `
      SELECT c.hash, c.text, c.source, c.timestamp, f.rank
      FROM chunks_fts f
      JOIN chunks c ON c.rowid = f.rowid
      WHERE chunks_fts MATCH ?
      ORDER BY f.rank
      LIMIT ?
    `;

    try {
      const rows = this.db.prepare(sql).all(sanitized, limit) as BM25Row[];
      if (rows.length > 0) return rows;
    } catch {
      /* FTS syntax error — try OR fallback */
    }

    const words = sanitized.split(/\s+/).filter(Boolean);
    if (words.length <= 1) return [];
    try {
      return this.db
        .prepare(sql)
        .all(words.join(" OR "), limit) as BM25Row[];
    } catch {
      return [];
    }
  }

  private applyTimeDecay(
    baseScore: number,
    timestamp: number,
    now: number,
    decayWindowDays: number,
  ): number {
    const ageDays = Math.max(0, (now - timestamp) / MS_PER_DAY);
    const decayFactor = Math.exp(-ageDays / decayWindowDays);
    return baseScore * (0.7 + 0.3 * decayFactor);
  }

  /** Hybrid search: BM25 candidates → optional vector reranking + time decay → top-K */
  async hybridSearch(
    query: string,
    topK = 5,
    options: HybridSearchOptions = {},
  ): Promise<SearchResult[]> {
    if (topK <= 0) return [];

    const candidates = this.searchBm25(query, 200);
    if (candidates.length === 0) return [];

    const rawScores = candidates.map((c) => Math.max(-c.rank, 0.001));
    const maxScore = Math.max(...rawScores);
    const now = Date.now();
    const decayWindowDays = Math.max(
      1,
      options.decayWindowDays ?? DEFAULT_DECAY_WINDOW_DAYS,
    );

    let scored: ScoredCandidate[] | null = null;

    if (isEmbeddingAvailable()) {
      try {
        const queryEmb = await embed(query);
        const cachedMap = this.getEmbeddingsFromCache(
          candidates.map((c) => c.hash),
        );

        scored = candidates.map((c, i) => {
          const bm25 = rawScores[i] / maxScore;
          const cached = cachedMap.get(c.hash);
          const vec = cached
            ? Math.max(0, cosineSimilarity(queryEmb, cached))
            : bm25;
          const baseScore =
            this.config.hybridWBm25 * bm25 + this.config.hybridWVec * vec;

          return {
            text: c.text,
            source: c.source,
            timestamp: c.timestamp,
            score: this.applyTimeDecay(
              baseScore,
              c.timestamp,
              now,
              decayWindowDays,
            ),
          };
        });
      } catch (e) {
        console.error("[memory-store] Vector rerank failed, using BM25:", e);
      }
    }

    if (!scored) {
      scored = candidates.map((c, i) => ({
        text: c.text,
        source: c.source,
        timestamp: c.timestamp,
        score: this.applyTimeDecay(
          rawScores[i] / maxScore,
          c.timestamp,
          now,
          decayWindowDays,
        ),
      }));
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(({ text, source, score }) => ({ text, source, score }));
  }

  /** Read cached embeddings for given hashes */
  private getEmbeddingsFromCache(hashes: string[]): Map<string, Embedding> {
    const result = new Map<string, Embedding>();
    if (hashes.length === 0) return result;

    const stmt = this.db.prepare(
      "SELECT hash, embedding FROM embedding_cache WHERE hash = ?",
    );
    for (const hash of hashes) {
      const row = stmt.get(hash) as {
        hash: string;
        embedding: Uint8Array;
      } | null;
      if (row) result.set(row.hash, blobToEmbedding(row.embedding));
    }

    if (result.size > 0) {
      const now = Date.now();
      const upd = this.db.prepare(
        "UPDATE embedding_cache SET used_at = ? WHERE hash = ?",
      );
      const tx = this.db.transaction(() => {
        for (const hash of result.keys()) upd.run(now, hash);
      });
      tx();
    }

    return result;
  }

  /** Cache embeddings with LRU eviction */
  cacheEmbeddings(
    entries: Array<{ hash: string; embedding: Embedding }>,
  ): void {
    if (entries.length === 0) return;
    const now = Date.now();
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO embedding_cache (hash, embedding, used_at) VALUES (?, ?, ?)",
    );
    const tx = this.db.transaction(() => {
      for (const e of entries) {
        stmt.run(e.hash, embeddingToBlob(e.embedding), now);
      }
      const row = this.db
        .prepare("SELECT COUNT(*) as cnt FROM embedding_cache")
        .get() as { cnt: number };
      if (row.cnt > this.config.embedCacheMax) {
        this.db
          .prepare(
            "DELETE FROM embedding_cache WHERE hash IN (SELECT hash FROM embedding_cache ORDER BY used_at ASC LIMIT ?)",
          )
          .run(row.cnt - this.config.embedCacheMax);
      }
    });
    tx();
  }

  /** Background: embed chunks missing from cache */
  async embedMissing(limit = 50): Promise<number> {
    if (!isEmbeddingAvailable()) return 0;

    const rows = this.db
      .prepare(
        `SELECT c.hash, c.text FROM chunks c
       LEFT JOIN embedding_cache ec ON c.hash = ec.hash
       WHERE ec.hash IS NULL LIMIT ?`,
      )
      .all(limit) as Array<{ hash: string; text: string }>;

    if (rows.length === 0) return 0;

    const embeddings = await embedBatch(rows.map((r) => r.text));
    this.cacheEmbeddings(
      rows.map((r, i) => ({ hash: r.hash, embedding: embeddings[i] })),
    );
    return rows.length;
  }

  /** Prune daily chunks older than N days */
  pruneOlderThan(daysAgo: number): number {
    const cutoff = Date.now() - daysAgo * 86_400_000;
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM chunks_fts WHERE rowid IN (SELECT rowid FROM chunks WHERE source LIKE 'daily/%' AND timestamp < ?)",
        )
        .run(cutoff);
      return this.db
        .prepare(
          "DELETE FROM chunks WHERE source LIKE 'daily/%' AND timestamp < ?",
        )
        .run(cutoff).changes;
    });
    return tx();
  }

  close(): void {
    this.db.close();
  }
}

// ─── Shared Store Cache ─────────────────────────────

const storeCache = new Map<string, MemoryStore>();

export function getMemoryStore(
  memoryRootDir: string,
  config: MemoryStoreConfig,
): MemoryStore {
  let store = storeCache.get(memoryRootDir);
  if (!store) {
    store = new MemoryStore(memoryRootDir, config);
    storeCache.set(memoryRootDir, store);
  }
  return store;
}

// ─── Migration from vectors.json ────────────────────

export async function migrateFromVectorsJson(
  memoryRootDir: string,
  store: MemoryStore,
): Promise<boolean> {
  const vectorsPath = join(memoryRootDir, "vectors.json");

  let raw: string;
  try {
    raw = await readFile(vectorsPath, "utf-8");
  } catch {
    return false;
  }

  try {
    const data = JSON.parse(raw) as {
      version: number;
      chunks: Array<{
        id: string;
        text: string;
        source: string;
        embedding: number[];
        timestamp: number;
      }>;
    };

    if (data.version !== 1 || !Array.isArray(data.chunks)) return false;

    store.upsert(data.chunks.map((c) => ({ text: c.text, source: c.source })));

    const withEmb = data.chunks
      .filter((c) => c.embedding?.length > 0)
      .map((c) => ({
        hash: MemoryStore.contentHash(c.text),
        embedding: c.embedding,
      }));
    if (withEmb.length > 0) store.cacheEmbeddings(withEmb);

    await rename(vectorsPath, vectorsPath + ".bak");
    console.log(
      `[memory-store] Migrated ${data.chunks.length} chunks (${withEmb.length} with embeddings)`,
    );
    return true;
  } catch (e) {
    console.error("[memory-store] Migration error:", e);
    return false;
  }
}

// ─── Chunking (migrated from vector-store.ts) ───────

export function chunkMarkdown(
  content: string,
  source: string,
  maxChunkChars = 500,
): Array<{ text: string; source: string }> {
  const chunks: Array<{ text: string; source: string }> = [];
  const lines = content.split("\n");
  let current = "";

  for (const line of lines) {
    if (line.startsWith("## ") && current.trim()) {
      pushChunks(chunks, current, source, maxChunkChars);
      current = line + "\n";
    } else {
      current += line + "\n";
    }
  }

  if (current.trim()) {
    pushChunks(chunks, current, source, maxChunkChars);
  }

  return chunks;
}

function pushChunks(
  chunks: Array<{ text: string; source: string }>,
  text: string,
  source: string,
  maxChars: number,
) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 10) return;

  if (trimmed.length <= maxChars) {
    chunks.push({ text: trimmed, source });
    return;
  }

  const paragraphs = trimmed.split(/\n\n+/);
  let buf = "";
  for (const para of paragraphs) {
    if (buf.length + para.length + 2 > maxChars && buf.trim()) {
      chunks.push({ text: buf.trim(), source });
      buf = para + "\n\n";
    } else {
      buf += para + "\n\n";
    }
  }
  if (buf.trim()) {
    chunks.push({ text: buf.trim(), source });
  }
}
