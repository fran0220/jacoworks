# Multi-Agent Avatar 体系设计方案

> 状态：实施中 | 创建：2026-03-30 | 更新：2026-03-31 | 优先级：P2

## 概述

为 webchat 多 Agent 团队提供 3D 数字人表现层。每个 Agent 拥有独立 Avatar，通过预设动作反映工作状态，提升协作的沉浸感和可读性。

## 核心原则

1. **纯视觉驱动，不依赖 TTS** — Avatar 通过 WS 事件驱动动画切换，不做语音合成
2. **Tripo GLB 管线** — 3D 模型通过 asset-gateway Tripo 链路生成 GLB（含内置 rig + animate），不使用 VRM
3. **用户自定义 + 系统默认** — 提供默认角色形象，用户可上传照片替换
4. **多 Agent 同屏** — 团队场景下多个 Avatar 共存，发言者聚焦
5. **复用现有引擎** — 基于已有 Observatory 原生 Three.js 引擎扩展，不引入 @react-three

## 现有基础设施

webchat 已具备完整的多 Agent 协作基础：

| 层 | 组件 | 状态 |
|---|---|---|
| 3D 引擎 | `observatory/` — 原生 Three.js + `@pixiv/three-vrm` | ✅ 完整 |
| Avatar 系统 | `AvatarFactory` / `AvatarPool` / `AvatarAnimator` / `AvatarNavigator` | ✅ 完整（VRM + fallback 胶囊体） |
| Agent 状态 | `TeamPresenceBar` + `useOperations` 轮询 JMOS feed | ✅ 完整 |
| 消息归属 | `AssistantHeader` 按 agentId 显示名称+角色徽章 | ✅ 完整 |
| @mention | `Composer` + `MentionPopover` 支持 `@planner` 等 | ✅ 完整 |
| 团队管理 | `TeamPanel` / `InstallTeamModal` / session 切换 | ✅ 完整 |
| Ops 监控 | `OpsSidebar` + `OpsOverview` + `OpsTimeline` | ✅ 完整 |

## 架构

```
┌─────────────────────────────────────────────────────────┐
│                 Avatar 资产管线 (Tripo GLB)               │
│                                                         │
│  用户照片/文字描述 → asset-gateway                        │
│    → generate model (GLB)                               │
│    → process3d rig --spec mixamo                        │
│    → process3d animate --animation preset:X (×N)        │
│    → COS 存储 → DB 记录 URL                              │
│                                                         │
├─────────────────────────────────────────────────────────┤
│             运行时渲染（复用 Observatory 引擎）             │
│                                                         │
│  AvatarPool 扩展：                                       │
│    GLB 加载路径 (GLTFLoader → AnimationMixer)             │
│    VRM 加载路径 (保留兼容)                                 │
│    Fallback 胶囊体 (无模型时)                              │
│                                                         │
│  AvatarAnimator 扩展：                                   │
│    AgentState → AnimationClip 名称映射                    │
│    AnimationMixer crossFade 切换                          │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                    多 Agent 场景                          │
│                                                         │
│  WS agentId → 发言者聚焦 (摄像机平滑跟踪)                 │
│  非发言者 idle 动画 + 面向发言者                           │
└─────────────────────────────────────────────────────────┘
```

## P0：Avatar 资产管线

### asset-gateway CLI 完整链路

```bash
# 1. 文字描述 → 3D 模型 (GLB)
asset-gateway generate model \
  --prompt "卡通风格男性办公室规划师，T-pose" \
  --model-version P1-20260311 \
  --face-limit 5000 --pbr \
  --output-dir ./avatars
# → metadata.tripo_task_id = "abc-123"

# 2. 自动绑骨 (Mixamo 骨骼)
asset-gateway process3d rig \
  --task-id abc-123 --spec mixamo \
  --output-dir ./avatars
# → data.tripo_task_id = "rig-456"

# 3. 生成各状态动画 (Tripo 内置 25+ 预设，直接出带动画的 GLB)
asset-gateway process3d animate --task-id rig-456 --animation preset:idle --output-dir ./avatars
asset-gateway process3d animate --task-id rig-456 --animation preset:walk --output-dir ./avatars
asset-gateway process3d animate --task-id rig-456 --animation preset:clap --output-dir ./avatars
asset-gateway process3d animate --task-id rig-456 --animation preset:wave_goodbye --output-dir ./avatars
asset-gateway process3d animate --task-id rig-456 --animation preset:sit --output-dir ./avatars
asset-gateway process3d animate --task-id rig-456 --animation preset:defeat --output-dir ./avatars
asset-gateway process3d animate --task-id rig-456 --animation preset:cheer --output-dir ./avatars

# 4. (可选) 风格化
asset-gateway process3d stylize --task-id abc-123 --style cartoon --output-dir ./avatars

# 5. (可选) 照片 → 3D (用户自定义头像)
asset-gateway generate model \
  --image "https://assets.xiaomao.chat/uploads/user-photo.jpg" \
  --model-version P1-20260311 --face-limit 5000 --pbr \
  --output-dir ./avatars
```

### 动作映射表

| Agent 状态 | Tripo 预设 | 触发条件 |
|---|---|---|
| 待机 | `idle` | 长时间无活动 |
| 行走/移动 | `walk` | 前往工作区域 |
| 工作中 | `sit` | Agent 正在执行任务 |
| 思考中 | `idle` (慢速) | Agent 在规划/推理 |
| 说话/汇报 | `wave_goodbye` | Agent streaming 输出 |
| 完成/庆祝 | `cheer` / `clap` | 任务完成 |
| 错误/困难 | `defeat` | 执行出错 |
| 审查中 | `walk` (慢) | Reviewer 巡检 |

### 成本估算

| 操作 | 单价 | 每角色数量 | 小计 |
|---|---|---|---|
| generate model | $0.40 | 1 | $0.40 |
| process3d rig | $0.25 | 1 | $0.25 |
| process3d animate | $0.25 | 6-7 个预设 | $1.50-1.75 |
| **每角色合计** | | | **~$2.15** |
| **4 角色团队** | | | **~$8.60** |

### 资产存储

```
COS: jacoworks-release/avatars/
  ├── default/                    # 系统默认 (每角色一套)
  │   ├── planner/
  │   │   ├── model.glb           # 绑骨模型
  │   │   ├── anim-idle.glb
  │   │   ├── anim-walk.glb
  │   │   ├── anim-sit.glb
  │   │   ├── anim-cheer.glb
  │   │   ├── anim-defeat.glb
  │   │   └── anim-wave.glb
  │   ├── executor/
  │   ├── reviewer/
  │   └── patrol/
  └── user/{user_id}/{agent_id}/  # 用户自定义
      └── ...
```

### DB 表

```sql
CREATE TABLE agent_avatars (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT REFERENCES users(id),        -- NULL = 系统默认
  agent_role TEXT NOT NULL,                     -- planner/executor/reviewer/patrol
  model_url  TEXT NOT NULL,                     -- COS URL: 绑骨模型
  anim_urls  JSONB NOT NULL DEFAULT '{}',       -- {"idle":"url","walk":"url",...}
  style      TEXT DEFAULT 'cartoon',            -- cartoon/realistic
  source     TEXT DEFAULT 'tripo',              -- tripo/upload
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_avatar_default ON agent_avatars(agent_role) WHERE user_id IS NULL;
CREATE UNIQUE INDEX idx_avatar_user ON agent_avatars(user_id, agent_role) WHERE user_id IS NOT NULL;
```

## P1：GLB Avatar 渲染

### 技术栈（复用现有）

```
three              # 已有 (^0.183)
GLTFLoader         # 已有 (three/addons)
AnimationMixer     # three 内置
@pixiv/three-vrm   # 保留兼容，GLB 路径不经过
```

### AvatarPool 扩展

当前 `AvatarPool` 仅支持 VRM，需增加 GLB 加载路径：

```typescript
// 新增：从 URL 加载 GLB 模型 + 动画
async loadGLBAvatar(agentId: string, modelUrl: string, animUrls: Record<string, string>): Promise<GLBAvatar> {
  const gltf = await this.gltfLoader.loadAsync(modelUrl);
  const mixer = new THREE.AnimationMixer(gltf.scene);

  // 加载各动画 GLB，提取 AnimationClip
  const clips: Record<string, THREE.AnimationClip> = {};
  for (const [name, url] of Object.entries(animUrls)) {
    const animGltf = await this.gltfLoader.loadAsync(url);
    if (animGltf.animations.length > 0) {
      clips[name] = animGltf.animations[0];
    }
  }

  return { scene: gltf.scene, mixer, clips, currentAction: null };
}
```

### AvatarAnimator 扩展

当前 `AvatarAnimator` 用程序化动画（呼吸/摇摆/弹跳）。GLB 模型改用 `AnimationMixer.clipAction` + `crossFadeTo`：

```typescript
// AgentState → AnimationClip 名称
const STATE_TO_CLIP: Record<AgentState, string> = {
  idle: "idle",
  spawning: "idle",
  walking: "walk",
  working: "sit",
  thinking: "idle",
  reviewing: "walk",
  celebrating: "cheer",
  patrolling: "walk",
  despawning: "defeat",
};

// 切换动画：crossFade 0.3s 过渡
setState(state: AgentState): void {
  const clipName = STATE_TO_CLIP[state];
  const clip = this.clips[clipName];
  if (!clip) return;
  const newAction = this.mixer.clipAction(clip);
  if (this.currentAction) {
    this.currentAction.crossFadeTo(newAction, 0.3, true);
  }
  newAction.play();
  this.currentAction = newAction;
}
```

### 加载优先级

```
1. 用户自定义 GLB (agent_avatars WHERE user_id = ?)
2. 系统默认 GLB  (agent_avatars WHERE user_id IS NULL)
3. VRM 模型      (现有 /observatory/vrm/ 路径)
4. Fallback 胶囊体 (现有 getFallbackMesh)
```

## P2：多 Agent 发言者聚焦

### 切换机制

- WS 消息的 `agentId` 字段标识发言者 → 自动切换摄像机焦点
- `focusAgent(id)`: 摄像机平滑 lerp 到目标 Agent 位置偏上方
- 非发言 Agent 保持 idle 动画，root.lookAt 朝向发言者
- 切换过渡时间: 0.5s ease-out

### 聊天面板联动

```
┌──────────┐  ┌─────────────────────────────────┐
│ Agent 列表│  │         对话区                    │
│          │  │                                   │
│ 🧑‍💼 Planner│  │  [Planner] "我来规划一下..."      │
│  ← active│  │    (Observatory 中聚焦 Planner)    │
│ 👨‍💻 Coder │  │                                   │
│ 🔍 Review│  │  --- Agent 切换 ---               │
│ 🛡️ Patrol│  │                                   │
│          │  │  [Coder] "好的，我开始实现..."     │
│          │  │    (摄像机平滑切到 Coder)          │
└──────────┘  └─────────────────────────────────┘
```

## P3：Avatar Profile 配置

### Agent Avatar Profile

```jsonc
{
  "agentId": "planner-001",
  "name": "策划师小林",
  "role": "planner",
  "avatar": {
    "source": "tripo",                    // tripo | upload
    "modelUrl": "/avatars/default/planner/model.glb",
    "animUrls": {
      "idle": "/avatars/default/planner/anim-idle.glb",
      "walk": "/avatars/default/planner/anim-walk.glb",
      "sit": "/avatars/default/planner/anim-sit.glb",
      "cheer": "/avatars/default/planner/anim-cheer.glb",
      "defeat": "/avatars/default/planner/anim-defeat.glb",
      "wave": "/avatars/default/planner/anim-wave.glb"
    },
    "style": "cartoon"
  }
}
```

### UI 入口

在 `TeamPanel` 或 `TeamStudioView` 中增加 Avatar 配置 Tab：
- 查看当前各角色 Avatar 3D 预览
- 上传照片 → 调用后端生成 → 替换
- 重置为系统默认

## 实施路线

| 阶段 | 内容 | 预估 | 前置 |
|------|------|------|------|
| **P0** | DB schema + oc-gateway Avatar CRUD API + 资产生成脚本 | 2 天 | asset-gateway Tripo 链路 (已有) |
| **P1** | AvatarPool/Animator 扩展 GLB 路径 + API 对接加载 | 3 天 | P0 |
| **P2** | 发言者聚焦摄像机 + 聊天消息联动 Observatory | 1 天 | P1 |
| **P3** | Avatar Profile 编辑器 UI (TeamPanel 扩展) | 2 天 | P0 |
| **P4** (可选) | TTS 语音层：流式 TTS + 唇形同步 | 2 周 | P1 |

## 技术依赖

### 前端（webchat，已有）

```
three ^0.183           # 核心 3D 引擎
GLTFLoader             # three/addons，GLB 加载
AnimationMixer         # three 内置，动画混合
@pixiv/three-vrm       # 保留兼容
```

### 资产生成

```
asset-gateway          # Tripo 链路 (generate model → rig → animate)
COS                    # 模型文件存储 (jacoworks-release 桶)
```

### 后端

- `agent_avatars` 表存储 Avatar Profile + COS URL
- oc-gateway 提供 `/api/avatars/*` CRUD API
- webchat 按需拉取 + IndexedDB 缓存

## 相关文档

- [Godot 集成方案](./godot-integration-plan.md) — 3D 游戏开发方向
- [设计系统](./design-system.md) — webchat UI 规范
- asset-gateway skill — Tripo 完整命令参考
