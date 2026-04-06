# Agent 精灵动画生成任务

> 为 30 个 AI Agent 角色生成手绘风精灵动画，用于 webchat / 桌面端 / 观测站

## 工作流

按 `asset-gateway`：`generate image --provider gemini` 生成角色参考图 → `generate sprite`（PixelEngine / `frame-engine-v1.1`）生成 idle 精灵表。批量脚本见下（旧版 sprite-workflow 中的即梦示例可忽略）。

输出目录: `webchat/public/sprites/{id}/`（与 [docs/sprite-production-spec.md](../docs/sprite-production-spec.md) 一致），每角色含 `ref.png`（512×768）与 `idle.png`（768×192 精灵表，6 帧）。

## 角色列表

### 🧠 核心智能体 (Core Agents)

| # | ID | 名称 | Prompt (静态图) | 动画 Prompt |
|---|-----|------|----------------|-------------|
| 1 | `aria` | **Aria** 首席协调官 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Young woman with silver-white short hair, golden pupils, wearing a white high-collar long coat with dark gold circuit-line patterns, a hovering holographic badge on chest. Modern sci-fi aesthetic, warm lighting, clean lines, soft cel-shading. | gentle idle breathing, subtle hair sway, holographic badge pulsing softly, smooth loop |
| 2 | `nova` | **Nova** 总架构师 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Woman with deep blue gradient long hair in a high ponytail, semi-transparent tech goggles on forehead, black trench coat with glowing blue circuit lines. Confident pose, modern sci-fi aesthetic, cool lighting. | idle breathing, ponytail swaying gently, circuit lines pulsing with light, smooth loop |
| 3 | `echo` | **Echo** 记忆管理者 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with light purple wavy curly hair, faint glowing marks near eyes, grey-white hooded cloak with glowing rune patterns on inner lining. Mysterious yet gentle, soft ethereal lighting. | gentle floating sway, cloak shifting slightly, rune patterns glowing rhythmically, smooth loop |

### 💻 工程团队 (Engineering)

| # | ID | 名称 | Prompt (静态图) | 动画 Prompt |
|---|-----|------|----------------|-------------|
| 4 | `coda` | **Coda** 全栈工程师 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Young man with messy brown hair, round glasses, wearing a dark grey hoodie with a backpack, holographic keyboard projection on wrist. Casual tech worker vibe, warm lighting. | idle breathing, fingers twitching slightly near holographic keyboard, smooth loop |
| 5 | `hex` | **Hex** 系统黑客 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with black spiky hair with green-dyed tips, dark techwear jacket with many pockets, single-lens cyber monocle glowing green. Edgy hacker aesthetic, cool neon lighting. | subtle idle sway, monocle flickering with data, jacket shifting slightly, smooth loop |
| 6 | `patch` | **Patch** 修复专家 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with orange-red short hair, freckles, wearing a utility vest with multi-pocket tool belt, holding a glowing wrench tool. Friendly mechanic vibe, warm golden lighting. | idle breathing, wrench tool glowing and pulsing, belt pouches swaying slightly, smooth loop |
| 7 | `byte` | **Byte** 数据工程师 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with clean black buzz cut, wearing dark turtleneck under white vest, data stream light flowing between fingers. Minimalist and precise, cool blue lighting. | subtle idle motion, data streams flowing between fingers rhythmically, smooth loop |
| 8 | `pixel` | **Pixel** 前端匠人 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with pink-blue gradient short hair, cat-ear headphones, wearing oversized streetwear t-shirt with cargo pants. Creative and playful vibe, vibrant lighting. | gentle idle bounce, headphone lights pulsing to a beat, smooth loop |

### 🎨 创意团队 (Creative)

| # | ID | 名称 | Prompt (静态图) | 动画 Prompt |
|---|-----|------|----------------|-------------|
| 9 | `muse` | **Muse** 创意总监 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Woman with wine-red long flowing hair, artist beret hat, wearing beige loose blouse with an artistic scarf. Elegant and creative, warm soft lighting. | idle breathing, hair flowing gently, scarf drifting in breeze, smooth loop |
| 10 | `sketch` | **Sketch** 视觉设计师 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with hair in double buns, paint smudges on face, wearing denim apron over rolled-sleeve white shirt, holding a stylus pen. Artsy and energetic, colorful lighting. | gentle idle sway, stylus twirling slightly in hand, smooth loop |
| 11 | `lyric` | **Lyric** 文案大师 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with silver long straight hair, thin-frame glasses, wearing black turtleneck sweater with coffee-brown jacket. Intellectual writer aesthetic, warm amber lighting. | subtle idle breathing, glasses catching light, jacket shifting slightly, smooth loop |
| 12 | `render` | **Render** 3D 艺术家 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with teal short hair with one side shaved, circuit-pattern tattoo on neck, black techwear suit with AR gloves glowing. Futuristic artist, cool cyan lighting. | idle breathing, AR gloves projecting faint holographic shapes, smooth loop |
| 13 | `chord` | **Chord** 音频工程师 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with dark brown dreadlocks, large over-ear headphones around neck, wearing deep purple aviator jacket. Music producer vibe, warm purple-tinted lighting. | gentle idle bob, headphones glowing softly with sound waves, smooth loop |

### 🔬 研究团队 (Research & Analysis)

| # | ID | 名称 | Prompt (静态图) | 动画 Prompt |
|---|-----|------|----------------|-------------|
| 14 | `atlas` | **Atlas** 知识探索者 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Young person with grey-white hair but youthful face, monocle on one eye, brown leather long coat with map scroll pouch on hip. Explorer-scholar aesthetic, warm adventurous lighting. | idle breathing, monocle glinting, coat swaying gently, smooth loop |
| 15 | `savant` | **Sage** 深度分析师 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with dark green short hair, calm composed expression, dark blazer over light blue dress shirt, miniature astrolabe brooch on chest. Professional analyst, cool steady lighting. | subtle idle breathing, astrolabe brooch rotating slowly, smooth loop |
| 16 | `prism` | **Prism** 数据可视化师 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with rainbow gradient short hair, large round glasses, white lab coat with colorful data-pattern scarf. Vibrant and analytical, prismatic colorful lighting. | gentle idle sway, rainbow scarf shimmering with color shifts, smooth loop |
| 17 | `oracle` | **Oracle** 预测分析师 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with white ornamental blind eyes (decorative) and a third-eye marking on forehead, wearing deep blue kimono-style tech robe with constellation patterns. Mystical futuristic seer, deep blue ethereal lighting. | gentle floating sway, constellation patterns on robe twinkling, third eye glowing softly, smooth loop |

### 🛡️ 运维与安全 (Ops & Security)

| # | ID | 名称 | Prompt (静态图) | 动画 Prompt |
|---|-----|------|----------------|-------------|
| 18 | `shield` | **Shield** 安全守卫 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Sturdy person with buzz cut, strong jawline, wearing dark grey tactical jacket with bulletproof-vest-style armor plate, energy arm shield. Military-tech guardian, cool steel lighting. | idle breathing, energy shield flickering faintly on arm, steady vigilant pose, smooth loop |
| 19 | `beacon` | **Beacon** 监控哨兵 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with bright yellow short hair, sharp hawk-like eyes, wearing black turtleneck with a small hovering drone companion floating beside shoulder. Alert watchful vibe, warm amber lighting. | subtle idle motion, drone orbiting slowly around shoulder, eyes scanning, smooth loop |
| 20 | `forge` | **Forge** 基础设施 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with brown curly hair in low ponytail, welding goggles pushed up on forehead, heavy-duty work coveralls with glowing tech gloves. Industrial builder vibe, warm forge-orange lighting. | idle breathing, gloves sparking faintly, goggles catching light, smooth loop |

### 📋 项目与协作 (Project & Collaboration)

| # | ID | 名称 | Prompt (静态图) | 动画 Prompt |
|---|-----|------|----------------|-------------|
| 21 | `sync` | **Sync** 协作协调员 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with split-colored hair (half black half white), ear-mounted communicator device, wearing sleek sporty zip-up jacket, holding a holographic tablet. Dynamic coordinator vibe, balanced warm-cool lighting. | idle breathing, communicator blinking, tablet displaying shifting data, smooth loop |
| 22 | `tempo` | **Tempo** 项目调度 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with blue-black short neat hair, two watches on wrist (one physical one holographic), wearing fitted black suit with subtle dark patterns. Precise timekeeper aesthetic, cool blue lighting. | subtle idle motion, holographic watch projecting time display, smooth loop |
| 23 | `scroll` | **Scroll** 文档管理 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with brown shoulder-length hair, reading glasses on a chain, wearing camel-colored knit cardigan, cradling a glowing book in arms. Warm librarian-scholar vibe, cozy golden lighting. | gentle idle breathing, book pages glowing and turning slowly, glasses swaying on chain, smooth loop |

### 🌐 外联与交互 (Communication & Interface)

| # | ID | 名称 | Prompt (静态图) | 动画 Prompt |
|---|-----|------|----------------|-------------|
| 24 | `link` | **Link** API 联络官 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with green short hair, friendly warm smile, wearing white polo shirt with tech badge on lanyard, light beams connecting between both hands. Approachable connector vibe, bright clean lighting. | idle breathing, connection beams between hands pulsing rhythmically, smooth loop |
| 25 | `vox` | **Vox** 语音交互 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Woman with golden curly hair, microphone-shaped earrings, wearing mint-green dress with sound wave pattern belt. Voice artist aesthetic, warm lively lighting. | gentle idle sway, sound wave patterns on belt animating, earrings swaying, smooth loop |
| 26 | `lens` | **Lens** 视觉识别 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with short hair and single-lens AR glasses with red lens, wearing photographer-style utility vest with multiple camera lens accessories. Sharp observer vibe, focused red-tinted lighting. | subtle idle motion, AR lens scanning with red light sweep, smooth loop |

### ⚡ 特殊角色 (Specialists)

| # | ID | 名称 | Prompt (静态图) | 动画 Prompt |
|---|-----|------|----------------|-------------|
| 27 | `spark` | **Spark** 快速原型 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with orange spiky hair, energetic excited expression, wearing sporty hoodie with lightning bolt graphic, skater shoes. High-energy prototyper vibe, electric yellow-orange lighting. | lively idle bounce, hoodie strings swaying, energetic micro-movements, smooth loop |
| 28 | `ghost` | **Ghost** 后台进程 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with semi-translucent pale grey long hair, dreamy hazy expression, wearing thin gauze-like dark flowing cape that fades at edges. Ethereal background process aesthetic, misty cool lighting. | gentle floating drift, cape edges dissolving and reforming, translucent shimmer, smooth loop |
| 29 | `rune` | **Rune** 自动化脚本 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with navy blue short hair, glowing rune stickers on forehead, wearing tech jumpsuit with holographic arm panel projections. Automation specialist, neon blue lighting. | idle breathing, rune stickers glowing in sequence, arm panel cycling through code, smooth loop |
| 30 | `core` | **Core** 系统内核 | Single character, full body, front-facing idle pose, transparent background. Semi-realistic hand-painted RPG chibi style. Person with pure white hair and glowing pupils, wearing minimalist white bodysuit with a glowing energy orb at chest center. Absolute core system entity, radiant white-blue lighting. | subtle hovering float, energy orb pulsing with power, hair flowing with energy, smooth loop |

## 自动化脚本

- 批量（**Gemini** 出 ref + frame-engine idle，可断点续跑；默认 `--image-provider gemini --image-size 1024x1792`）：[`scripts/batch_agent_sprites.py`](../scripts/batch_agent_sprites.py)
- 补齐缺失的 `ref.png` / `idle.png`（规格占位）及从 `idle` 复制 5 种表情占位：[`scripts/fill_agent_sprite_gaps.py`](../scripts/fill_agent_sprite_gaps.py) — `uv run --with pillow python scripts/fill_agent_sprite_gaps.py`
- 批量替换 expression 占位为独立动画（支持重试 + 审计）：[`scripts/batch_agent_expressions.py`](../scripts/batch_agent_expressions.py)
- 远端 `sprite` provider 不可用时的本地回退（基于 `ref.png` 生成 6 帧语义动画表）：[`scripts/fallback_expression_sheets.py`](../scripts/fallback_expression_sheets.py)

## 状态

- [x] 工作流验证 (Pixel Engine API 测试通过, frame-engine-v1.1 支持 HD 手绘)
- [x] asset-gateway CLI 全流程确认 (generate image → process crop/resize → generate sprite)
- [x] Core 30 角色目录已完整（每目录具备 `ref.png` + `idle.png` + `thinking/speaking/working/happy/error.png`）
- [x] Village 10 角色目录已纳入同一规范统计（当前总体为 40/40 目录完整）
- [x] expression 资源已替换为独立动画（`thinking/speaking/working/happy/error` 不再与 `idle` 同 hash）
- [x] 不合格项已修复：已移除 `_gemini_test` 临时目录；`ember` / `flint` / `iris` 的 `ref.png` 已修正为 `512x768`
- [x] 集成到 webchat 前端（`sprite-packs.ts` 注册 30 项 + 村庄 10 项共存；`savant` 与村庄 `sage` 解耦）
- [x] 各角色 thinking / speaking / working / happy / error 独立动画已完成（40 角色 × 5 状态）

## 进度审计（2026-04-06）

- 审计范围：`webchat/public/sprites/` 下 **30 core + 10 village**，共 40 个角色目录。
- 审计口径：目录完整性（`ref.png`、`idle.png`、5 种 expression 文件）、规格符合性（`ref.png` 必须 `512x768`；`idle.png` 必须 `768x192`）。
- 已确认并已修复问题：
  - `_gemini_test` 临时目录已移除。
  - `ember` / `flint` / `iris` 的 `ref.png` 已从 `848x1264` 修正为 `512x768`。
- 当前结论：目录覆盖为 40/40，规格检查通过；expression 独立动画已完成，`audit-only` 结果为 `placeholder_count=0`。

## 收尾记录（2026-04-06）

- 并行批次执行：4 组 CLI 任务并发生成 expression 动画，并持续轮询审计（placeholder 计数从 186 逐步降至 0）。
- 运行期问题：`pixelengine` 后期出现 `no credits available`，导致少量角色连续 `502 PROVIDER_ERROR`。
- 处置方案：对失败尾项切换到本地回退脚本 `fallback_expression_sheets.py`，生成语义化 6 帧表并替换占位。
- 最终验收：`python scripts/batch_agent_expressions.py --audit-only` 返回 `missing_count=0`、`placeholder_count=0`。

## Subagent 实施计划

1. 审计
   - 内容：按 30 core + 10 village 全量扫描目录与图片尺寸，输出缺失项与规格差异清单。
   - 验收标准：形成唯一审计清单，覆盖 40/40 目录，且每项问题有目录名与文件级证据。
2. 清理
   - 内容：移除 `_gemini_test` 临时目录及其他非交付产物，确保正式目录仅保留可发布资源。
   - 验收标准：`webchat/public/sprites/` 下无 `_gemini_test`，且目录集合与角色清单一一对应。
3. 修复
   - 内容：将 `ember` / `flint` / `iris` 的 `ref.png` 修正为 `512x768`；必要时重生成并保持风格一致。
   - 验收标准：三者 `ref.png` 全部为 `512x768`，透明背景与主体构图满足现有规范。
4. 复核
   - 内容：二次执行全量尺寸与文件完整性检查，并抽样核对 expression 是否仍为占位复制。
   - 验收标准：无新增规格错误；占位项状态与文档一致，不出现“文档与资产不一致”。
5. 收尾
   - 内容：更新本任务文档状态与审计结论，记录已修复项与待办项，冻结交付口径。
   - 验收标准：文档状态、实际资产、检查结果三者一致，可直接作为后续动画深化基线。
