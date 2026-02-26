/**
 * OpenAI Embedding API 客户端
 * 使用 text-embedding-3-small (1536 维) 生成文本向量
 */

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const OPENAI_EMBEDDING_URL = "https://api.openai.com/v1/embeddings";

// ─── 批量限制 ───────────────────────────────────────
const MAX_BATCH_SIZE = 96; // OpenAI 单次最多 2048，但小批量更稳定

export type Embedding = number[];

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage?: { prompt_tokens: number; total_tokens: number };
}

let _apiKey = "";

export function initEmbedding(apiKey: string) {
  _apiKey = apiKey;
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
  if (!_apiKey) throw new Error("OpenAI API key not configured for embedding");
  if (texts.length === 0) return [];

  const allEmbeddings: Embedding[] = new Array(texts.length);

  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);
    const res = await fetch(OPENAI_EMBEDDING_URL, {
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
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Embedding API ${res.status}: ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as EmbeddingResponse;
    for (const item of json.data) {
      allEmbeddings[i + item.index] = item.embedding;
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
