/**
 * Embedding API 客户端
 * 支持 OpenAI 兼容的 embedding 服务 (可通过 EMBEDDING_BASE_URL 配置)
 * 默认使用 text-embedding-3-small (1536 维)
 */

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

// ─── 批量限制 ───────────────────────────────────────
const MAX_BATCH_SIZE = 96;

export type Embedding = number[];

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage?: { prompt_tokens: number; total_tokens: number };
}

let _apiKey = "";
let _baseUrl = "https://api.openai.com/v1";
let _timeoutMs = 5000;

export function initEmbedding(apiKey: string, baseUrl?: string, timeoutMs?: number) {
  _apiKey = apiKey;
  if (baseUrl) {
    _baseUrl = baseUrl.replace(/\/+$/, "");
  }
  if (timeoutMs !== undefined) {
    _timeoutMs = timeoutMs;
  }
}

export function isEmbeddingAvailable(): boolean {
  return _apiKey.length > 0;
}

/**
 * 生成单条文本的 embedding
 */
export async function embed(text: string): Promise<Embedding> {
  const results = await embedBatch([text]);
  return results[0];
}

/**
 * 批量生成 embedding（自动分片）
 */
export async function embedBatch(texts: string[]): Promise<Embedding[]> {
  if (!_apiKey) throw new Error("Embedding API key not configured");
  if (texts.length === 0) return [];

  const embeddingUrl = `${_baseUrl}/embeddings`;
  const allEmbeddings: Embedding[] = new Array(texts.length);

  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), _timeoutMs);

    try {
      const res = await fetch(embeddingUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${_apiKey}`,
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: batch,
          dimensions: EMBEDDING_DIMENSIONS,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Embedding API ${res.status} (${_baseUrl}): ${body.slice(0, 300)}`);
      }

      const json = (await res.json()) as EmbeddingResponse;
      for (const item of json.data) {
        allEmbeddings[i + item.index] = item.embedding;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return allEmbeddings;
}

/**
 * 余弦相似度
 */
export function cosineSimilarity(a: Embedding, b: Embedding): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL };
