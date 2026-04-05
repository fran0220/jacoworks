# 精灵动画虚拟形象方案

> 2025-04-05 · 状态: 规划中

## 核心目标

1. **对话虚拟形象**: Agent 对话（含团队对话）时展示虚拟形象，随状态和表情变化
2. **协作观测可视化**: Agent 团队协作调度的 2D 游戏化可视观测场景

## 方案选型

| 方案 | 资产生产 | 前端依赖 | 结论 |
|------|----------|----------|------|
| VRM 3D 模型 | 手工制作或自动生成，质量有限 | Three.js + @pixiv/three-vrm (~1MB) | ❌ 当前方案，效果差 |
| Live2D | 画师 + Cubism Editor，2-3天/角色 | pixi.js + cubism SDK (~500KB) | ❌ 资产生产成本太高 |
| **精灵动画** | **asset-gateway 批量生成，10分钟/角色** | **PixiJS 或纯 CSS，极轻** | ✅ 采用 |

### 精灵动画优势

- 资产生产完全自动化 (asset-gateway generate image + --ref 保持一致性)
- 对话场景和观测场景共享同一套资产
- 零额外重依赖，纯 CSS 或轻量 Canvas
- 用户创建新 Agent 时可自动生成全套精灵
- 本质上是用做游戏的方法做可视化

## 资产规格

### 每个 Agent 需要的精灵资产

| 精灵表 | 帧数 | 尺寸 | 用途 |
|--------|------|------|------|
| 半身像 (portrait) | 6 张表情 | 512×512 | 对话场景 (LeaderAssistant / ChatView / PresenceBar) |
| 行走 (walk) | 4方向 × 4帧 = 16帧 | 64×64 per frame | 观测场景区域间移动 |
| 待机 (idle) | 2帧 | 64×64 | 观测场景呼吸微动 |
| 工作 (work) | 4帧 | 64×64 | 观测场景工位动画 |
| 思考 (think) | 2帧 | 64×64 | 观测场景思考状态 |
| 庆祝 (celebrate) | 4帧 | 64×64 | 观测场景任务完成 |

### 半身像表情映射

| 表情帧 | WS 事件 | 视觉描述 |
|--------|---------|----------|
| `idle` | 默认 / done 后静息 | 中性表情 |
| `thinking` | thinking_start | 手托下巴 / 眼睛看上方 |
| `speaking` | text_delta | 张嘴 / 微笑 |
| `working` | tool_start | 专注 / 看屏幕 |
| `happy` | task_complete / done | 开心 / 庆祝 |
| `error` | error 事件 | 困惑 / 皱眉 |

### 资产生产流水线 (asset-gateway)

```bash
# 1. 生成角色基础立绘
asset-gateway generate image \
  --prompt "anime style half-body portrait, female AI planner character, blue theme, neutral expression, transparent background, character sheet" \
  --size 1024x1024 --output-dir ./sprites/planner

# 2. 用第一张作为 ref 生成其他表情（保持角色一致性）
asset-gateway generate image \
  --prompt "same character, thinking expression, hand on chin" \
  --ref ./sprites/planner/idle.png \
  --output-dir ./sprites/planner

# 3. 去背景 + 统一裁切
asset-gateway process remove-bg --input ./sprites/planner/thinking.png --output-dir ./sprites/planner
asset-gateway process resize --input ./sprites/planner/thinking.png --width 512 --height 512 --output-dir ./sprites/planner

# 4. 生成行走精灵表（俯视 / 等距风格）
asset-gateway generate image \
  --prompt "pixel art top-down character spritesheet, 4 directions walk cycle, 4 frames each, blue-themed planner character, transparent background" \
  --size 1024x1024 --output-dir ./sprites/planner
```

## 场景 1: 对话虚拟形象

### 组件架构

```
SpriteAvatar (通用精灵头像组件)
  ├─ props: agentId, expression, size, animated
  ├─ 根据 expression 切换帧 (CSS transition opacity)
  ├─ 叠加 CSS animation (breathing / bounce / sway)
  └─ 尺寸适配: large(LeaderAssistant) / medium(ChatView) / small(PresenceBar)
```

### 使用位置

| 位置 | 尺寸 | 动画 |
|------|------|------|
| LeaderAssistant 半身像 | 大 (~200px) | 表情切换 + 呼吸 + 说话弹跳 |
| ChatView agent attribution | 中 (40px) | 当前表情帧 |
| TeamPresenceBar | 小 (24px) | idle/working 两帧 |
| TeamPanel 角色卡片 | 中 (48px) | idle 静态 |

### 替换计划

- LeaderAssistant: 替换 Three.js LeaderScene → SpriteAvatar + CSS
- ChatView: 在 agent 消息头部添加 SpriteAvatar
- TeamPresenceBar: 角色 dot → SpriteAvatar mini

## 场景 2: 协作观测 (2D 游戏化)

### 设计参考

| 游戏 | 借鉴点 |
|------|--------|
| Habbo Hotel | 等距像素风，角色在房间走动互动 |
| 星露谷物语 | 俯视 2D 精灵，行走/工作/庆祝动画 |
| RimWorld | 俯视多角色自主调度，实时观察 |
| 双点医院 | 等距视角，员工在功能区间移动协作 |

### 场景布局

```
┌─────────────────────────────────────────────────┐
│              2D 等距观测场景                       │
│                                                   │
│   🏢 指挥塔(tower)    ⚒️ 锻造厂(forge)             │
│     👤 planner          👤 executor                │
│     💭"分析需求..."      🔨"编写代码..."             │
│                                                   │
│            🛤️ ← agent 沿路径行走 → 🛤️              │
│                                                   │
│   ⚖️ 审判庭(court)    🛋️ 休息区(lounge)            │
│     👤 reviewer          👤 patrol                 │
│     📋"审核PR..."        🚶 巡逻中...               │
│                                                   │
└─────────────────────────────────────────────────┘
```

### 技术选型

**渲染引擎**: PixiJS (2D WebGL/Canvas)
- 最成熟的 2D 精灵游戏引擎
- 如果以后想加 Live2D，pixi-live2d-display 天然兼容
- 比 Three.js 轻量得多，移动端友好

### 复用现有系统

| 现有模块 | 改造方式 |
|----------|----------|
| AvatarNavigator (寻路逻辑) | 坐标系从 3D → 2D |
| AvatarAnimator (状态机) | 改为驱动精灵帧切换 |
| AgentStateManager (事件桥接) | 完全不用改 |
| ZoneManager (区域/槽位) | 改为 2D 坐标 |
| WaypointGraph (路径网络) | 降维到 2D |
| EventBridge (FeedLog → 事件) | 完全不用改 |

## 实施计划

### Phase 1: 对话虚拟形象 (SpriteAvatar)

- [ ] 设计 SpriteAvatar React 组件
- [ ] 用 asset-gateway 为 4 个预设角色生成半身像表情集
- [ ] LeaderAssistant 替换 Three.js → SpriteAvatar
- [ ] ChatView agent attribution 添加 SpriteAvatar
- [ ] TeamPresenceBar 添加 SpriteAvatar mini

### Phase 2: 2D 观测场景

- [ ] 引入 PixiJS 替换 Three.js 观测场景
- [ ] 设计等距/俯视地图 (Zone 建筑 + 路径)
- [ ] 实现精灵行走动画 (spritesheet 帧播放)
- [ ] 实现工作/思考/庆祝动画
- [ ] 状态气泡 + 任务标签
- [ ] 迁移 Navigator/StateManager/EventBridge

### Phase 3: 自动化流水线

- [ ] Agent 创建时自动调用 asset-gateway 生成全套精灵
- [ ] 精灵资产存储 + CDN 分发
- [ ] 用户自定义头像上传 → 自动生成表情帧
- [ ] 团队模板预置精灵主题包
