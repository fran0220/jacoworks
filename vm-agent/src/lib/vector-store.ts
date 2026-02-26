/**
 * 本地向量存储 — JSON 文件持久化 + 余弦相似度检索
 *
 * 存储结构: <memoryRoot>/vectors.json
 * 每个 chunk 包含: id, text, source (文件名), embedding, timestamp
 *
 * 设计原则:
 * - 写入时增量更新，不全量重建
 * - 启动时一次性加载到内存
 * - 基于内容 hash 去重（同一段文字不重复 embed）
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import {
  type Embedding,
  embed,
  embedBatch,
  cosineSimilarity,
  isEmbeddingAvailable,
} from "./embedding.js";

// ─── Types ──────────────────────────────────────────

export interface VectorChunk {
  id: string; // content hash
  text: string;
  source: string; // e.g. "MEMORY.md" | "daily/2026-02-26.md"
  embedding: Embedding;
  timestamp: number; // ms since epoch
}

interface StoreData {
  version: 1;
  chunks: VectorChunk[];
}

export interface SearchResult {
  text: string;
  source: string;
  score: number;
  timestamp: number;
}

// ─── Vector Store ───────────────────────────────────

export class VectorStore {
  private chunks = new Map<string, VectorChunk>();
  private dirty = false;
  private storePath: string;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(memoryRootDir: string) {
    this.storePath = join(memoryRootDir, "vectors.json");
  }

  /** 启动时加载持久化数据 */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.storePath, "utf-8");
      const data: StoreData = JSON.parse(raw);
      if (data.version === 1 && Array.isArray(data.chunks)) {
        for (const chunk of data.chunks) {
          this.chunks.set(chunk.id, chunk);
        }
      }
    } catch {
      // 首次使用或文件损坏，从空开始
    }
  }

  /** 持久化到磁盘 */
  async flush(): Promise<void> {
    if (!this.dirty) return;
    const data: StoreData = {
      version: 1,
      chunks: Array.from(this.chunks.values()),
    };
    await mkdir(dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, JSON.stringify(data), "utf-8");
    this.dirty = false;
  }

  /** 延迟写入（防抖） */
  private scheduleDirtyFlush() {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(async () => {
      this.flushTimer = null;
      await this.flush().catch((e) =>
        console.error("[vector-store] flush error:", e),
      );
    }, 5_000);
  }

  /** 当前存储的 chunk 数量 */
  get size(): number {
    return this.chunks.size;
  }

  /** 内容 hash (用于去重) */
  static contentHash(text: string): string {
    return createHash("sha256").update(text).digest("hex").slice(0, 16);
  }

  /**
   * 索引一批文本 chunk（增量更新，跳过已有）
   * @returns 新增的 chunk 数量
   */
  async index(
    items: Array<{ text: string; source: string }>,
  ): Promise<number> {
    if (!isEmbeddingAvailable()) return 0;

    // 过滤掉已索引的
    const toEmbed: Array<{ text: string; source: string; id: string }> = [];
    for (const item of items) {
      const id = VectorStore.contentHash(item.text);
      if (!this.chunks.has(id)) {
        toEmbed.push({ ...item, id });
      }
    }

    if (toEmbed.length === 0) return 0;

    const embeddings = await embedBatch(toEmbed.map((i) => i.text));
    const now = Date.now();

    for (let i = 0; i < toEmbed.length; i++) {
      this.chunks.set(toEmbed[i].id, {
        id: toEmbed[i].id,
        text: toEmbed[i].text,
        source: toEmbed[i].source,
        embedding: embeddings[i],
        timestamp: now,
      });
    }

    this.scheduleDirtyFlush();
    return toEmbed.length;
  }

  /**
   * 删除指定 source 的所有 chunk（文件更新前先清旧数据）
   */
  removeBySource(source: string): number {
    let removed = 0;
    for (const [id, chunk] of this.chunks) {
      if (chunk.source === source) {
        this.chunks.delete(id);
        removed++;
      }
    }
    if (removed > 0) this.scheduleDirtyFlush();
    return removed;
  }

  /**
   * 语义搜索 — 返回 top-K 最相关的 chunk
   */
  async search(query: string, topK = 5, minScore = 0.3): Promise<SearchResult[]> {
    if (!isEmbeddingAvailable() || this.chunks.size === 0) return [];

    const queryEmbedding = await embed(query);

    const scored: SearchResult[] = [];
    for (const chunk of this.chunks.values()) {
      const score = cosineSimilarity(queryEmbedding, chunk.embedding);
      if (score >= minScore) {
        scored.push({
          text: chunk.text,
          source: chunk.source,
          score,
          timestamp: chunk.timestamp,
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /** 清理 n 天前的 daily log chunks */
  pruneOlderThan(daysAgo: number): number {
    const cutoff = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
    let pruned = 0;
    for (const [id, chunk] of this.chunks) {
      if (chunk.source.startsWith("daily/") && chunk.timestamp < cutoff) {
        this.chunks.delete(id);
        pruned++;
      }
    }
    if (pruned > 0) this.scheduleDirtyFlush();
    return pruned;
  }

  /** 关闭时确保写入 */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}

// ─── Chunking Utilities ─────────────────────────────

/**
 * 将 Markdown 按 ## 标题分 chunk
 * 每个 chunk 包含标题行 + 内容，最大 ~500 字符
 */
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
      // 输出当前 chunk
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

  // 超长内容按段落拆分
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
