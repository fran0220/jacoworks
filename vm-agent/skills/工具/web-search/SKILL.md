---
name: web-search
display-name: 网络搜索
display-description: 多源智能搜索与内容提取
description: >
  Multi-source search with intent-aware scoring.
  Integrates Exa, Tavily, and Grok (via LLM proxy) to provide
  high-coverage, high-quality results. Automatically classifies query intent
  and adjusts search strategy, scoring weights, and result synthesis accordingly.
  Use when the user asks to search the web, look up information, research a topic,
  find documentation, or needs up-to-date facts.
---

# Web Search — 意图感知多源检索协议

三源并行：Exa + Tavily + Grok。按意图自动选策略、调权重、做合成。

## 执行流程

```
用户查询
    ↓
[Phase 1] 意图分类 → 确定搜索策略
    ↓
[Phase 2] 查询分解 & 扩展 → 生成子查询
    ↓
[Phase 3] 多源并行检索 → search.mjs (Exa + Tavily + Grok)
    ↓
[Phase 4] 结果合并 & 排序 → 去重 + 意图加权评分
    ↓
[Phase 5] 知识合成 → 结构化输出
```

---

## Phase 1: 意图分类

收到搜索请求后，**先判断意图类型**，再决定搜索策略。不要问用户用哪种模式。

| 意图 | 识别信号 | Mode | Freshness | 权重偏向 |
|------|---------|------|-----------|---------|
| **Factual** | "什么是 X"、"X 的定义"、"What is X" | answer | — | 权威 0.5 |
| **Status** | "X 最新进展"、"X 现状"、"latest X" | deep | pw/pm | 新鲜度 0.5 |
| **Comparison** | "X vs Y"、"X 和 Y 区别" | deep | py | 关键词 0.4 + 权威 0.4 |
| **Tutorial** | "怎么做 X"、"X 教程"、"how to X" | answer | py | 权威 0.5 |
| **Exploratory** | "深入了解 X"、"X 生态"、"about X" | deep | — | 权威 0.5 |
| **News** | "X 新闻"、"本周 X"、"X this week" | deep | pd/pw | 新鲜度 0.6 |
| **Resource** | "X 官网"、"X GitHub"、"X 文档" | fast | — | 关键词 0.5 |

> 详细分类指南见 `references/intent-guide.md`

**判断规则**：
1. 扫描查询中的信号词
2. 多个类型匹配时选最具体的
3. 无法判断时默认 `exploratory`

---

## Phase 2: 查询分解 & 扩展

根据意图类型，将用户查询扩展为一组子查询：

### 通用规则
- **技术同义词自动扩展**：k8s→Kubernetes, JS→JavaScript, Go→Golang, Postgres→PostgreSQL
- **中文技术查询**：同时生成英文变体（如 "Rust 异步编程" → 额外搜 "Rust async programming"）

### 按意图扩展

| 意图 | 扩展策略 | 示例 |
|------|---------|------|
| Factual | 加 "definition"、"explained" | "WebTransport" → "WebTransport", "WebTransport explained overview" |
| Status | 加年份、"latest"、"update" | "Deno 进展" → "Deno 2.0 latest 2026", "Deno update release" |
| Comparison | 拆成 3 个子查询 | "Bun vs Deno" → "Bun vs Deno", "Bun advantages", "Deno advantages" |
| Tutorial | 加 "tutorial"、"guide"、"step by step" | "Rust CLI" → "Rust CLI tutorial", "Rust CLI guide step by step" |
| Exploratory | 拆成 2-3 个角度 | "RISC-V" → "RISC-V overview", "RISC-V ecosystem", "RISC-V use cases" |
| News | 加 "news"、"announcement"、日期 | "AI 新闻" → "AI news this week 2026", "AI announcement latest" |
| Resource | 加具体资源类型 | "Anthropic MCP" → "Anthropic MCP official documentation" |

---

## Phase 3: 多源并行检索

对子查询调用 search.mjs，传入意图和 freshness：

```bash
node {baseDir}/scripts/search.mjs \
  --queries "子查询1" "子查询2" "子查询3" \
  --mode deep \
  --intent status \
  --freshness pw \
  --num 5
```

**各模式源参与矩阵**：
| 模式 | Exa | Tavily | Grok | 说明 |
|------|-----|--------|------|------|
| fast | ✅ | ❌ | fallback | Exa 优先；无 Exa key 时用 Grok |
| deep | ✅ | ✅ | ✅ | 三源并行 |
| answer | ❌ | ✅ | ❌ | 仅 Tavily（含 AI answer） |

**参数说明**：
| 参数 | 说明 |
|------|------|
| `--queries` | 多个子查询并行执行（也可用位置参数传单个查询） |
| `--mode` | fast / deep / answer |
| `--intent` | 意图类型，影响评分权重（不传则不评分） |
| `--freshness` | pd(24h) / pw(周) / pm(月) / py(年) |
| `--domain-boost` | 逗号分隔的域名，匹配的结果权威分 +0.2 |
| `--num` | 每源每查询的结果数 |
| `--source` | 指定使用的源 (exa,tavily,grok)，默认全部可用源 |

**Grok 源说明**：
- 通过 LLM 中转站 (`LLM_PROXY_URL`) 调用 Grok 模型，利用其实时知识返回结构化搜索结果
- 自动检测时间敏感查询并注入当前时间上下文
- 在 deep 模式下与 Exa、Tavily 并行执行
- 如果 Grok 配置缺失，自动降级为 Exa + Tavily 双源

**环境变量**（由 Tauri 启动时注入或 .env 配置）：
| 变量 | 说明 |
|------|------|
| `EXA_API_KEY` | Exa 搜索 API 密钥 |
| `TAVILY_API_KEY` | Tavily 搜索 API 密钥 |
| `LLM_PROXY_URL` | LLM 中转站地址（Grok 源使用，默认 `http://67.230.171.248:8317`） |
| `LLM_PROXY_KEY` | LLM 中转站密钥（Grok 源使用） |
| `GROK_MODEL` | Grok 模型名（默认 `grok-4.1-fast`） |

---

## Phase 4: 结果排序

search.mjs 已内置意图加权评分。输出 JSON 中每个结果含 `score` 字段。

### 评分公式

```
score = w_keyword × keyword_match + w_freshness × freshness_score + w_authority × authority_score
```

权重由意图决定（见 Phase 1 表格）。

### Domain Boost

通过 `--domain-boost` 参数手动指定需要加权的域名：
```bash
node {baseDir}/scripts/search.mjs "query" --mode deep --intent tutorial --domain-boost dev.to,freecodecamp.org
```

推荐搭配：
- Tutorial → `dev.to, freecodecamp.org, realpython.com, baeldung.com`
- Resource → `github.com`
- News → `techcrunch.com, arstechnica.com, theverge.com`

---

## Phase 5: 知识合成

根据结果数量选择合成策略：

### 小结果集（≤5 条）
逐条展示，每条带源标签和评分：
```
1. [Title](url) — snippet... `[exa, tavily]` ⭐0.85
2. [Title](url) — snippet... `[grok]` ⭐0.72
```

### 中结果集（5-15 条）
按主题聚类 + 每组摘要：
```
**主题 A: [描述]**
- [结果1] — 要点... `[source]`
- [结果2] — 要点... `[source]`
```

### 大结果集（15+ 条）
高层综述 + Top 5 + 深入提示

### 合成规则
- **先给答案，再列来源**
- **按主题聚合，不按来源聚合**
- **冲突信息显性标注**
- **置信度表达**：多源一致 → 直接陈述；单源 → "根据 [source]，..."

---

## 降级策略

- Exa 429/5xx → 继续 Tavily + Grok
- Tavily 429/5xx → 继续 Exa + Grok
- Grok 超时/错误 → 继续 Exa + Tavily
- search.mjs 整体失败 → 告知用户搜索暂时不可用
- **永远不要因为某个源失败而阻塞主流程**

---

## 获取网页内容

当需要读取特定 URL 的完整内容时，使用 curl：

```bash
curl -sL -m 30 -A "Mozilla/5.0" "<URL>" | head -c 50000
```

如果返回的是 HTML，提取正文要点即可。对于中文站点（微信公众号、知乎等），内容可能被反爬拦截，此时告知用户无法直接获取。

---

## 快速参考

| 场景 | 命令 |
|------|------|
| 快速事实 | `search.mjs "query" --mode answer --intent factual` |
| 深度调研 | `search.mjs --queries "q1" "q2" --mode deep --intent exploratory` |
| 最新动态 | `search.mjs "query" --mode deep --intent status --freshness pw` |
| 对比分析 | `search.mjs --queries "A vs B" "A pros" "B pros" --intent comparison` |
| 找资源 | `search.mjs "query" --mode fast --intent resource` |
