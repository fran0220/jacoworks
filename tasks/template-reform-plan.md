# 团队模板体系改造方案

> 目标：移除 JaMOSS 强依赖，采用 Solo Founder Team 的「文件驱动 + 定时心跳」轻量协作模式。重构默认团队（数字之城 5 人展示），并内置一批社区精选模板。

## 一、架构转型：JaMOSS → 文件协作

| 维度 | 旧 (JaMOSS) | 新 (Solo Founder) |
|------|------------|-------------------|
| 协调方式 | task-cli.py → REST API (port 6565) | 共享 Markdown 文件 (GOALS.md / STATUS.md) |
| 任务调度 | Task → Module → SubTask 状态机 | Leader 在 GOALS.md 列优先级，agent 读取后自主执行 |
| 审查 | 专职 reviewer + 评分系统 | Leader 晨会/日报时汇总审阅 |
| 巡检 | 专职 patrol + 超时检测 | 去掉，Leader 心跳自带检查 |
| 中间件 | JMOS Go 二进制 (port 6565) | 无 (`middleware` 字段不出现) |
| Skill | task-cli.py 命令大全 | web_search 模式 + 文件协作规范 |
| 模型 | 全员 gpt-5.4 | 按角色差异化选模型 |

### 共享记忆层（所有模板通用）

```
/data/teams/{team_id}/
  GOALS.md              # 当前目标和优先级 (Leader 写，全员读)
  STATUS.md             # 运营状态实时快照 (全员可更新自己部分)
  DECISIONS.md          # 重要决策记录 (append-only)
  agents/
    {agent-id}/
      notes.md          # 私人笔记 (仅该 agent 读写)
      output/           # 该 agent 的产出
  content/              # 团队正式产出 (可选)
```

**核心原则**:
1. **共享记忆 + 私有上下文** — agent 读共识文件 (GOALS/STATUS)，写私人笔记积累领域知识
2. **文件即协调** — read + write 是最好的协调机制，不需要 REST API
3. **定时任务是飞轮** — 价值来自 agent 主动产出，不是被动等指令
4. **模型匹配任务** — 搜索密集型用 Gemini，创意/推理用 Sonnet，深度统筹用 Opus

---

## 二、默认团队 — 数字之城 v2（5 人展示团队）

### 设计理念

数字之城是**展示模板**，需要足够多角色展现多 agent 协作魅力。去掉 JaMOSS 中间件，但保留丰富角色。核心改造：
- 去掉「督导官」「巡城官」两个 JaMOSS 工具人角色
- 新增「舆情官」— 全网趋势嗅探 + 舆论风向标，为其他 agent 提供"眼睛"
- 每个 agent 用**不同模型、不同 cron 节奏、不同人格**，展示差异化
- 从"任务状态机驱动"改为"时间节奏驱动"，像一个真实团队的工作日

### 5 人阵容

| 角色 | ID | 模型 | 人格 | Cron 节奏 |
|------|-----|------|------|-----------|
| 🏙️ 亦城 | `yicheng` | claude-sonnet-4-6 | 温暖专业的城市代言人 | **8AM 晨会 + 9PM 日报** |
| ⚔️ 电竞官 | `esports` | claude-sonnet-4-6 | 热血解说，激情澎湃 | **每 3h** (10AM/1PM/4PM/7PM/10PM) |
| 🍜 生活官 | `lifestyle` | gemini-3.1-pro-preview | 接地气的探店达人 | **11AM + 5PM** |
| 📢 应援官 | `cheerleader` | claude-sonnet-4-6 | 高能量粉丝领袖 | **每 4h** 赛事节奏 |
| 🔍 舆情官 | `sentinel` | gemini-3.1-pro-preview | 冷静的数据分析师 | **每 2h** 全网扫描 |

### 各角色详细说明

**🏙️ 亦城 (Lead)** — 城市主理人 + 用户对话窗口
- 8AM 读各 agent 昨日 notes → 更新 GOALS.md 今日优先级 → 搜索今日赛事
- 9PM 汇总所有 agent 产出 → 写 `content/{date}/city-daily.md` → 更新 STATUS.md
- 用户直接对话入口，能即时搜索回答赛事/场馆问题

**⚔️ 电竞官** — 赛事情报专家
- 每 3h 搜索 LPL/KPL/JDG 赛事动态
- 产出: 赛程速览、赛前分析、赛后复盘 → `agents/esports/output/`
- 私有记忆: 积累战队/选手数据，记住 BP 趋势

**🍜 生活官** — 亦庄本地生活达人
- 11AM 午间推荐（午餐 + 新店）+ 5PM 晚间推荐（宵夜 + 赛后聚餐）
- 搜索范围: 赛事中心 3km，大众点评/美团/小红书多源交叉
- 产出: 美食攻略、优惠速报、组局方案 → `agents/lifestyle/output/`

**📢 应援官** — 粉丝领袖
- 赛事节奏: 赛前造势 + 赛后回应
- 读舆情官产出感知粉丝情绪，读电竞官产出了解赛事进展
- 产出: 造势文案、应援口号、互动话题 → `agents/cheerleader/output/`

**🔍 舆情官** (新角色，替代督导官+巡城官)
- 每 2h 扫描: 微博热搜、B站趋势、电竞论坛、小红书
- 产出: 热点速报、舆情快照、趋势预警 → `agents/sentinel/output/`
- 为其他 agent 提供"眼睛": 电竞官据此深挖，应援官据此写文案

### 信息流动

```
舆情官 (每 2h)
  → agents/sentinel/output/trends.md
  ↓
电竞官 (读趋势→深挖赛事)      应援官 (读趋势→创作文案)
  → agents/esports/output/      → agents/cheerleader/output/
  ↓                              ↓
生活官 (读赛事→赛后聚餐推荐)
  → agents/lifestyle/output/
  ↓
亦城 (8AM 读全员 notes→GOALS.md / 9PM 汇总→city-daily.md)
```

### 文件变更清单

| 操作 | 文件 |
|------|------|
| **重写** | `template.json` (5 人 + 无 middleware + 差异化模型/cron + theme) |
| **重写** | `prompts/yicheng.md` (文件协作 + GOALS/STATUS 统筹) |
| **重写** | `prompts/esports.md` (自主 cron + 读舆情产出 + 私有 notes) |
| **重写** | `prompts/lifestyle.md` (自主 cron + 搜索驱动) |
| **重写** | `prompts/cheerleader.md` (读舆情+赛事产出 → 创作) |
| **新建** | `prompts/sentinel.md` (舆情官 prompt) |
| **新建** | `workspace/GOALS.md` (今日优先级模板) |
| **新建** | `workspace/STATUS.md` (城市状态快照) |
| **新建** | `workspace/DECISIONS.md` (空，append-only) |
| **重写** | `workspace/AGENTS.md` (5 人 + 文件协作说明) |
| **重命名** | `skills/city-planner-skill/` → `skills/city-lead-skill/` 并重写 |
| **重写** | `skills/city-esports-skill/` (去 task-cli) |
| **重写** | `skills/city-lifestyle-skill/` (去 task-cli) |
| **重写** | `skills/city-cheerleader-skill/` (去 task-cli，加读舆情) |
| **新建** | `skills/city-sentinel-skill/` (舆情搜索模式) |
| 保留 | `workspace/data/schedule.json` `workspace/data/venues.json` |
| **删除** | `prompts/inspector.md` `prompts/patroller.md` |
| **删除** | `skills/city-reviewer-skill/` `skills/city-patrol-skill/` |
| **删除** | `rules/city-rules.md` (融入 workspace/AGENTS.md) |

---

## 三、Solo Founder 通用模板

### 定位

给「新建团队」用的**参考模板**。4 人创业团队框架，展示文件协作最佳实践。

### 4 人阵容

| 角色 | ID | 模型 | Cron |
|------|-----|------|------|
| 🎯 战略官 | `strategist` | claude-opus-4-6 | 8AM standup + 6PM recap |
| 📊 分析师 | `analyst` | claude-sonnet-4-6 | 每 4h 竞品/数据监控 |
| 📢 市场官 | `marketer` | gemini-3.1-pro-preview | 每 2h 热点扫描 + 内容草稿 |
| ⚙️ 执行者 | `builder` | gpt-5.3-codex | 每 4h 读 GOALS → 执行开发任务 |

### 共享记忆

```
GOALS.md           # 当前 OKR（战略官写）
STATUS.md          # 项目状态（全员更新自己部分）
DECISIONS.md       # 决策日志（append-only）
```

### theme

```json
{
  "sceneKind": "startup-office",
  "title": "创业团队",
  "icon": "🚀",
  "palette": {
    "primary": "#6366f1",
    "secondary": "#22d3ee",
    "accent": "#f59e0b",
    "background": "#0f172a",
    "surface": "#1e293b"
  }
}
```

---

## 四、社区精选模板

从 awesome-openclaw-usecases (28.1k ⭐) 精选适合内置的非开发模板：

### Tier 1 — 第一批内置

#### 1. `content-factory` — 内容工厂 🏭

> 灵感: Multi-Agent Content Factory + 7-Agent Marketing Team

| Agent | 角色 | 模型 | Cron |
|-------|------|------|------|
| 🎬 主编 | lead | claude-sonnet-4-6 | 8AM 选题 + 8PM 审稿 |
| 🔍 调研员 | researcher | gemini-3.1-pro-preview | 每 3h 热点扫描 (Reddit/X/HN) |
| ✍️ 写手 | writer | claude-sonnet-4-6 | 读调研产出 → 成稿，每 4h |
| 🎨 设计师 | designer | gemini-3.1-flash-image-preview | 读成稿 → 配图描述，每 4h |

**共享记忆**: `TOPICS.md`(选题池) / `CALENDAR.md`(内容日历) / `STYLE_GUIDE.md`(风格指南)
**信息流**: 调研员→热点 → 主编→选题 → 写手→成稿 → 设计师→配图 → 主编→审稿发布
**特色**: 用户说"帮我写一篇XX文章"，主编自动分配全流程

#### 2. `morning-brief` — 每日简报 ☀️

> 灵感: Custom Morning Brief

| Agent | 角色 | 模型 | Cron |
|-------|------|------|------|
| 📰 简报官 | lead | claude-sonnet-4-6 | **7:30AM** 汇编简报 |
| 🌐 新闻员 | news-scanner | gemini-3.1-pro-preview | **7:00AM** 多源扫描 |
| 📊 数据员 | data-tracker | claude-sonnet-4-6 | **6:30AM** 拉取关注指标 |

**共享记忆**: `INTERESTS.md`(用户兴趣) / `SOURCES.md`(信息源) / `WATCHLIST.md`(关注指标)
**产出**: `briefs/{date}.md` — 每天一份定制简报
**特色**: 配置兴趣关键词 + RSS 源 + 关注的股票/币种，每天早上收到一份精选简报

#### 3. `research-team` — 研究助手团 🔬

> 灵感: Market Research + arXiv Paper Reader + HF Papers Discovery

| Agent | 角色 | 模型 | Cron |
|-------|------|------|------|
| 🧑‍🔬 研究主管 | lead | claude-opus-4-6 | 按需 + 每日汇总 |
| 📚 文献员 | scholar | gemini-3.1-pro-preview | 每 4h 论文/报告扫描 |
| 📈 分析员 | analyst | claude-sonnet-4-6 | 读文献 → 深度分析 |

**共享记忆**: `RESEARCH_QUESTIONS.md` / `FINDINGS.md` / `BIBLIOGRAPHY.md`
**特色**: 提出研究问题 → 团队自动搜索论文、竞品、市场数据 → 输出结构化研究报告

#### 4. `podcast-studio` — 播客工作室 🎙️

> 灵感: Podcast Production Pipeline

| Agent | 角色 | 模型 | Cron |
|-------|------|------|------|
| 🎙️ 制片人 | lead | claude-sonnet-4-6 | 按需统筹 |
| 🔍 调研员 | researcher | gemini-3.1-pro-preview | 按需深挖嘉宾/话题 |
| ✍️ 文案 | copywriter | claude-sonnet-4-6 | 读调研 → 大纲/show notes |

**流程**: 录前(嘉宾调研+大纲+问题) → 录后(时间戳笔记+SEO描述+社交媒体套件)
**特色**: 从选题到 show notes + 社交推广物料全自动

#### 5. `social-media` — 社媒运营团 📱

> 灵感: X/Twitter Automation + Content Repurposer + Engagement Intel

| Agent | 角色 | 模型 | Cron |
|-------|------|------|------|
| 📱 运营总监 | lead | claude-sonnet-4-6 | 9AM 日计划 + 6PM 复盘 |
| 👁️ 趋势猎手 | trend-hunter | gemini-3.1-pro-preview | 每 2h 全平台热点 |
| ✍️ 文案手 | copywriter | claude-sonnet-4-6 | 读热点 → 多平台适配文案 |
| 💬 互动官 | engagement | claude-sonnet-4-6 | 每 3h 找评论/回复机会 |

**共享记忆**: `BRAND_VOICE.md`(品牌调性) / `CONTENT_CALENDAR.md` / `ENGAGEMENT_QUEUE.md`
**特色**: 互动官是隐藏杀手锏 — 找到值得回复的高质量对话，比发推文更涨粉

### Tier 2 — 后续扩展

| 模板 | 角色数 | 一句话 |
|------|--------|--------|
| `personal-assistant` | 2 | 管家 + 日程员：日历提醒 + 习惯追踪 + 邮件摘要 |
| `trading-desk` | 3 | 策略师 + 数据员 + 风控员：市场监控 + 策略回测 + 风险预警 |
| `game-studio` | 4 | 制作人 + 程序员 + 美术 + 测试：Godot 游戏开发 (已有 godotforge) |
| `customer-service` | 3 | 客服主管 + 工单员 + 知识员：多渠道客服 + 知识库维护 |
| `event-planner` | 3 | 策划官 + 嘉宾员 + 宣传员：活动策划 + 嘉宾邀请 + 宣传推广 |

---

## 五、Gateway 代码改动

### 5.1 InstallTemplate — 条件化 JMOS 同步

当前 `template.go` L630-638 每次安装模板都会 SyncJMOSConfig + RestartJMOS。改为仅在 middleware 声明时执行：

```go
// template.go InstallTemplate() 内：
if manifest.Middleware.Type == "jamoss" {
    jmosConfigChanged, err := c.SyncJMOSConfig(...)
    // ...
}
```

### 5.2 保持 JaMOSS 模板兼容

`jamoss` 模板继续保留不动。新模板不写 `middleware` 字段即可。

### 5.3 cron 字段已支持数组

`openclawTemplateAgent.Cron` 是 `json.RawMessage`，直接透传到 OpenClaw，已支持数组形式。无需改 Go 代码。

---

## 六、执行计划

### Phase 1 — 默认团队 v2 + Gateway 改动
1. Gateway: InstallTemplate 条件化 JMOS 同步
2. 重写 agent-city template.json (5 人 + 无 middleware)
3. 重写 5 个 prompts (去 task-cli → 文件协作)
4. 重写/新建 5 个 skills (去 task-cli → web_search + 文件)
5. 新建共享记忆文件 (GOALS.md / STATUS.md / DECISIONS.md / AGENTS.md)
6. 删除旧文件 (inspector/patroller prompts + skills + rules)
7. 测试: make deploy-local → 安装模板 → 验证 cron 运行

### Phase 2 — Solo Founder 模板
8. 创建 `openclaw/templates/solo-founder/` 全套
9. 4 个角色 prompts + skills + workspace 文件
10. 测试安装

### Phase 3 — 社区模板 Tier 1
11. `content-factory` (内容工厂，4 agent)
12. `morning-brief` (每日简报，3 agent)
13. `research-team` (研究助手，3 agent)
14. `podcast-studio` (播客工作室，3 agent)
15. `social-media` (社媒运营，4 agent)

### Phase 4 — Tier 2 模板
16. 按需从 Tier 2 列表中挑选实现
