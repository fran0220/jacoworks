# Agent 虚拟形象与团队可视化方案

> 2025-04-05 · 状态: 实施中

## 核心目标

1. **Agent 对话精灵**: 单聊页面 Composer 右侧显示 Agent 精灵头像，支持小头像/大头像折叠切换，随对话状态变化表情
2. **团队村庄场景**: 每个 Agent 团队拥有独立的星露谷风格 2D 村庄，全屏展示团队协作实况
3. **大观测站**: 城市级俯瞰所有团队（后续规划，本期不实现）

## 技术选型

| 方案 | 资产生产 | 前端依赖 | 结论 |
|------|----------|----------|------|
| VRM 3D 模型 | 手工制作或自动生成，质量有限 | Three.js + @pixiv/three-vrm | ❌ 当前方案，效果差 |
| Live2D | 画师 + Cubism Editor，2-3天/角色 | pixi.js + cubism SDK | ❌ 资产生产成本太高 |
| **精灵动画** | **asset-gateway 批量生成 + itch.io 场景资源** | **PixiJS 或纯 CSS/Canvas** | ✅ 采用 |

## 已购资产

| 资源包 | 路径 | 内容 |
|--------|------|------|
| Cainos Village ($40) | `game/Pixel Art Top Down - Village v1.0.7/` | 完整岛屿村庄场景 + 20建筑 + 203道具 + 55植物 + PSD + 分层贴图 |
| Sprout Lands Basic (免费) | `game/Sprout Lands - Sprites - Basic pack/` | 角色4方向×4帧行走 + 动物 + 家具 + 植物 + 瓦片 |

### Cainos Village 场景布局

完整岛屿地图，分区：
- **农业区 (西北)**: 4块农田 + 农舍 + 水井
- **市场区 (东北)**: 市场摊位 + 石塔哨塔
- **居民区 (中/东)**: L型大宅 + 围栏院落 + 储物箱
- **海岸 (南/西)**: 码头 + 石桥 + 营火休息区

贴图分层（`Texture/` 目录）：
- `TX Tileset Grass/Dirt/Terrain.png` — 地面层
- `TX Village Building.png` + `Shadow.png` — 建筑层（分离阴影）
- `TX Village Props.png` + `Animated.png` — 道具层（含动画道具）
- `TX Village Plant.png` — 植物层
- `FX/` — 火焰/烟雾特效

### Sprout Lands 角色精灵

- `Characters/Basic Charakter Spritesheet.png` — 4方向 × 4帧行走，48x48 cell
- `Characters/Basic Charakter Actions.png` — 动作帧
- `Characters/Tools.png` — 工具动画

## Phase 1: Agent 对话精灵 (SpriteAvatar)

### 位置与交互

精灵头像位于 **Composer 输入框上方右侧**，两种形态可折叠切换：

```
┌─────────────────────────────────┐
│         消息列表                  │
│                                  │
│  🤖 Agent: 正在分析你的需求...    │
│                                  │
│                          ┌─────┐ │
│                          │ 大  │ │  ← 展开态
│                          │ 头  │ │
│                          │ 像  │ │
│                          └─────┘ │
├──────────────────────────────────┤
│  [输入消息...]            🔹48px │ ← 折叠态 (默认)
└──────────────────────────────────┘
```

### 小头像 (折叠态, 默认)

- **尺寸**: 48px 圆形
- **位置**: Composer 右侧，与发送按钮同行
- **内容**: 当前表情帧 + 状态指示点 (🟢工作/🟡思考/⚪空闲)
- **动画**: 说话时轻微弹跳 (CSS)
- **交互**: 点击展开为大头像

### 大头像 (展开态)

- **尺寸**: ~200px 宽半身像
- **位置**: Composer 上方右侧浮动，不遮挡消息列表
- **内容**: 完整表情帧 + 状态文字 ("思考中..." / "编写代码...")
- **动画**: 表情切换 (CSS transition opacity) + 呼吸微动 + 说话弹跳
- **交互**: 点击或向下拖折叠回小头像

### 表情帧映射 (WS 事件 → 表情)

| 表情帧 | WS 事件 | 视觉描述 |
|--------|---------|----------|
| `idle` | 默认 / done 后静息 | 中性表情 |
| `thinking` | thinking_start | 手托下巴 / 眼睛看上方 |
| `speaking` | text_delta | 张嘴 / 微笑 |
| `working` | tool_start | 专注 / 看屏幕 |
| `happy` | task_complete / done | 开心 / 庆祝 |
| `error` | error 事件 | 困惑 / 皱眉 |

### 资产生产 (asset-gateway)

每个 Agent 预设生成一组半身像表情：

```bash
# 生成基础立绘
asset-gateway generate image \
  --prompt "pixel art half-body portrait, AI planner character, blue theme, neutral, transparent bg" \
  --size 512x512 --transparent --output-dir ./sprites/planner

# 用 ref 保持一致性生成其他表情
asset-gateway generate batch \
  --prompt "same character, thinking, hand on chin" \
  --prompt "same character, speaking, slight smile, mouth open" \
  --prompt "same character, focused, looking at screen" \
  --prompt "same character, happy, celebrating" \
  --prompt "same character, confused, frowning" \
  --ref ./sprites/planner/idle.png \
  --transparent --size 512x512 \
  --output-dir ./sprites/planner
```

### 组件结构

```
webchat/src/components/
  SpriteAvatar.tsx          — 通用精灵头像组件
    props: agentId, expression, size('sm'|'lg'), onToggle
    小头像: 48px 圆形 + 状态点 + 点击展开
    大头像: 200px 半身像 + 表情切换 + CSS动画 + 状态文字
  SpriteAvatarPanel.tsx     — Composer 旁的浮动面板 (位置/折叠逻辑)

webchat/src/hooks/
  useAgentExpression.ts     — WS 事件 → expression 状态机

webchat/public/sprites/     — Agent 精灵资产
  default/idle.png thinking.png speaking.png working.png happy.png error.png
  researcher/...
  coder/...
  writer/...
```

### 集成点

- `ChatView.tsx` — 在 Composer 区域旁渲染 SpriteAvatarPanel
- `useConversation.ts` — 暴露当前流式状态 (thinking/speaking/tool/done)
- `useAgentExpression.ts` — 消费流式状态，输出 expression 枚举

## Phase 2: 团队村庄场景

### 入口与导航

```
TeamPanel (团队页)
  ├─ 团队列表卡片
  │   └─ [进入小镇 🏘️] 按钮
  └─ 点击 → 全屏村庄场景 (React.lazy)
       └─ 左上角 [← 返回] 退出回 TeamPanel
```

### 场景架构

每个团队一个独立村庄实例，共享同一套场景资产（Cainos Village），但 Agent 角色不同。

```
webchat/src/village/
  VillageScene.tsx          — 全屏村庄容器 (Canvas 或 PixiJS)
  VillageMap.ts             — 场景底图渲染 (分层: 地面→建筑→道具→植物)
  VillageAgent.ts           — Agent 精灵管理 (创建/移动/动画)
  VillageZone.ts            — 建筑 ↔ Agent 角色映射 + 坐标定义
  VillageBridge.ts          — AgentSummary/FeedLog → 村庄事件 (复用现有 EventBridge)
```

### 建筑 ↔ Agent 角色映射

| 场景建筑 | Agent 角色 | 活动描述 |
|----------|-----------|----------|
| 🏛️ 大宅 (L-shaped house) | Planner / Leader | 调度总部，桌上摊地图 |
| 📚 石塔 (watchtower) | Reviewer / Patrol | 高处巡视，审查代码 |
| ⚒️ 市场摊位 (market stalls) | Executor / Coder | 忙碌工作，烟囱冒烟 |
| 🌿 农舍 (farm house) | Researcher | 图书馆/研究室 |
| 🏕️ 营火 (campfire) | 空闲 Agent | 休息/等待任务 |
| 🌾 农田 (crop plots) | 任务可视化 | 种子→发芽→成熟 = 任务 0%→50%→100% |
| 🌉 码头 (docks) | 输入/输出 | 新任务"到港"，完成"出港" |
| ⛲ 广场 (central area) | 汇合点 | Agent 交接任务时走到这里 |

### Agent 精灵动画

使用 Sprout Lands 角色精灵表格式 (4方向 × 4帧):

| 动画 | 帧数 | 触发 |
|------|------|------|
| walk | 4方向 × 4帧 | Agent 在建筑间移动 |
| idle | 2帧 (呼吸) | Agent 在工位上 |
| work | 4帧 | Agent 正在执行任务 |

每个 Agent 角色通过 `generate batch` + `process3d render-sprites` 生成独特外观，但遵循相同精灵表格式。

### Agent 行为状态机

```
idle (营火/广场)
  → 收到任务 → walk(到工位建筑)
  → 到达 → work(在建筑里)
  → thinking → idle(建筑内,手托下巴)
  → tool_use → work(建筑内,忙碌动画)
  → done → walk(到广场汇报)
  → 无任务 → walk(回营火) → idle
```

### 渲染方案

- **底图**: Cainos Village `Scene Overview.png` 或从分层贴图合成，作为 `<img>` 或 Canvas 背景
- **Agent 精灵**: DOM 绝对定位 (简单方案) 或 PixiJS Canvas 叠加 (性能方案)
- **状态气泡**: DOM 浮动元素，跟随精灵位置
- **路径动画**: CSS transition 或 requestAnimationFrame 插值

## Phase 3: 自动化流水线 (后续)

- Agent 创建时自动调用 asset-gateway 生成全套精灵 (半身像6表情 + 行走精灵表)
- 精灵资产存储方案 (本地 public/ 或 CDN)
- 用户自定义头像上传 → 自动生成表情帧
- 团队模板预置精灵主题包

## 不在本期范围

- 大观测站 (城市级俯瞰所有团队) — 后续单独设计
- 语音/TTS 驱动嘴巴动画 — 后续考虑
- 实时多人观看同一村庄 — 后续考虑
