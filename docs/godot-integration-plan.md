# Godot 游戏开发集成方案 — 实施文档

> JAcoworks 通过 OpenClaw 远程容器集成 Godot 引擎，让 Agent 能够创建/编辑场景、运行调试游戏、导出 Web 版本并发布到公开游戏广场。
> 桌面端零改动，全部能力通过容器预装 + Skill + Gateway API 实现。

## 1. 架构概览

```
用户: "帮我做个 2D 平台跳跃游戏"
  │
  ├─ 桌面端 (Tauri, 零改动)
  │   OpenClaw 模式 → WebSocket → 网关 WS 代理
  │
  ├─ OpenClaw 容器 (ARM64 Linux)
  │   Agent (已有 bash/write 工具)
  │   ├─ Skill 层 (game-dev-ai)
  │   │   Agent 加载 SKILL.md → 了解 Godot 最佳实践 + CLI 用法
  │   │
  │   ├─ Godot 4.6.1 (预装在容器模板中)
  │   │   godot --headless --script godot_operations.gd
  │   │   创建场景、运行项目、验证脚本、导出 Web
  │   │
  │   ├─ Xvfb 虚拟显示 (可选, 截图/渲染时使用)
  │   │
  │   └─ Web Export Template (预装, 导出浏览器可玩版本)
  │
  ├─ Gateway (jingao, 新增 /api/games/deploy)
  │   接收容器上传的游戏文件 → 存储到静态目录 → 写入 games 表
  │
  └─ 官网游戏广场 (jaco.jingao.club/games)
      公开页面，任何人可浏览、试玩，带作者归属
```

### 方案选型依据

| 方案 | 评估 | 结论 |
|------|------|------|
| 本地 Extension (vm-agent godot.ts) | 用户需自装 Godot，各平台差异大 | ❌ 放弃 (作为可选保留) |
| GDAI MCP Plugin ($19) | 许可证禁止再分发 (non-transferable, no redistribution)，Pi SDK 不支持 MCP 协议，无 ARM64 Linux .so | ❌ 不可行 |
| **OpenClaw 容器预装 Godot** | 复用现有基础设施，用户零安装，环境标准化，ARM64 原生支持 | ✅ 采用 |

### 关键约束

- **桌面端零改动** — 全部通过 OpenClaw 模式 (已有 WebSocket 通道)
- **vm-agent 零代码改动** — 容器内 Agent 已有 bash/write 工具，Godot 当普通 CLI 调用
- **Godot 是免费开源 (MIT)** — 可自由预装到容器模板
- **godot-mcp 的 godot_operations.gd (MIT)** — 可自由使用和分发

## 2. 文件变更清单

### 新增文件

```
vm-agent/skills/
└── 开发/
    └── game-dev-ai/
        ├── SKILL.md                          # 主技能文件 (Godot CLI + GDScript 规范)
        └── references/
            ├── godot-best-practices.md       # GDScript 编码规范
            ├── godot-cli-reference.md        # Godot headless CLI 命令参考
            └── anti-patterns.md              # 反模式清单

gateway/internal/games/
└── handler.go                                # 游戏部署 API (上传 + 元数据)

website/src/
├── routes/games.rs                           # 游戏广场路由 (列表 + 详情 + iframe)
├── models/game.rs                            # Game 数据模型
└── templates/
    └── games/
        ├── gallery.html                      # 游戏大厅页面
        └── play.html                         # 游戏详情 + 内嵌 iframe

deploy/
├── sql/005_games.sql                         # games 表 DDL
└── openclaw/setup-godot.sh                   # 容器模板 Godot 安装脚本

vm-agent/scripts/
└── godot_operations.gd                       # Godot headless 操作脚本 (MIT, 来自 godot-mcp)
```

### 修改文件

```
gateway/cmd/gateway/main.go                   # 注册 /api/games/* 路由
website/src/routes/mod.rs                     # 新增 pub mod games
website/src/models/mod.rs                     # 新增 pub mod game (如有 mod.rs)
website/templates/base.html                   # 导航栏加 "游戏广场" 链接
```

## 3. 容器模板配置

### 3.1 Godot 安装脚本 (`deploy/openclaw/setup-godot.sh`)

在 oracle (10.0.1.3) 上执行，更新 `tpl-openclaw` 容器模板：

```bash
#!/bin/bash
# 在 tpl-openclaw 容器中安装 Godot 4.6.1 ARM64 + Web Export Template
set -euo pipefail

GODOT_VERSION="4.6.1"
GODOT_URL="https://downloads.godotengine.org/${GODOT_VERSION}/stable/Godot_v${GODOT_VERSION}-stable_linux.arm64.zip"
EXPORT_TPL_URL="https://downloads.godotengine.org/${GODOT_VERSION}/stable/export_templates.tpz"

echo "📦 Installing Godot ${GODOT_VERSION} ARM64..."

# 1. 下载并安装 Godot
cd /tmp
wget -q "${GODOT_URL}" -O godot.zip
unzip -o godot.zip
mv "Godot_v${GODOT_VERSION}-stable_linux.arm64" /usr/local/bin/godot
chmod +x /usr/local/bin/godot
rm godot.zip

# 2. 安装 Web Export Template
echo "📦 Installing Web Export Template..."
wget -q "${EXPORT_TPL_URL}" -O templates.tpz
mkdir -p ~/.local/share/godot/export_templates/${GODOT_VERSION}.stable
unzip -o templates.tpz -d /tmp/tpl
mv /tmp/tpl/templates/* ~/.local/share/godot/export_templates/${GODOT_VERSION}.stable/
rm -rf templates.tpz /tmp/tpl

# 3. 安装 Xvfb (虚拟显示, 截图用)
apt-get update -qq && apt-get install -y -qq xvfb > /dev/null

# 4. 放入 godot_operations.gd
mkdir -p /opt/godot-tools
# godot_operations.gd 需从 godot-mcp 仓库复制到此处
# cp /path/to/godot_operations.gd /opt/godot-tools/

# 5. 创建 Web 导出预设模板
mkdir -p /opt/godot-tools/templates
cat > /opt/godot-tools/templates/export_presets.cfg << 'EOF'
[preset.0]
name="Web"
platform="Web"
runnable=true
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path="export/web/index.html"

[preset.0.options]
html/export_icon=true
html/custom_html_shell=""
html/head_include=""
progressive_web_app/enabled=false
EOF

# 6. 验证
echo "✅ Godot $(godot --version) installed"
echo "✅ Web Export Template installed"
echo "✅ Xvfb installed: $(which Xvfb)"
```

### 3.2 容器内环境

安装后容器内可用命令：

| 命令 | 用途 |
|------|------|
| `godot --version` | 版本检查 (4.6.1.stable) |
| `godot --headless --path <project> --script /opt/godot-tools/godot_operations.gd -- <op> <json>` | 场景操作 (创建/修改/保存) |
| `godot --headless --path <project>` | 运行项目 (逻辑层, 无画面) |
| `godot --headless --check-only --path <project>` | 语法检查 |
| `Xvfb :99 -screen 0 1280x720x24 &` | 启动虚拟显示 |
| `DISPLAY=:99 godot --path <project>` | 带渲染运行 (可截图) |
| `godot --headless --export-release "Web" export/web/index.html` | 导出 Web 版本 |

### 3.3 Export Template 预配置

容器模板需预装 Web Export Template (~800MB)，这样 Agent 可以直接执行导出，无需用户操作。

Agent 在创建新项目时自动复制导出预设：
```bash
# Agent 创建项目后执行
cp /opt/godot-tools/templates/export_presets.cfg <project>/export_presets.cfg
mkdir -p <project>/export/web
```

## 4. Skill 设计 (game-dev-ai)

### 4.1 SKILL.md 结构

```markdown
---
name: game-dev-ai
display-name: 游戏开发助手
display-description: 使用 Godot 引擎开发游戏，支持创建、调试、导出和发布
description: >
  Game development with Godot Engine. Creates scenes, scripts, runs and
  debugs games using Godot CLI. Exports to Web and deploys to game gallery.
  Triggers on: 做游戏, 开发游戏, game development, godot, 游戏开发.
---
```

### 4.2 Skill 核心指令

Skill 教会 Agent 以下能力：

**项目生命周期:**
1. 创建项目 (`project.godot` + 目录结构)
2. 创建/编辑场景 (通过 `godot_operations.gd` 或直接写 `.tscn` 文件)
3. 编写 GDScript (通过 `write` 工具)
4. 运行测试 (`godot --headless`)
5. 修复错误 (解析 stderr)
6. 导出 Web (`godot --export-release "Web"`)
7. 部署到游戏广场 (`curl POST /api/games/deploy`)

**GDScript 规范 (嵌入 Skill):**
- 命名: PascalCase 类, snake_case 函数/变量, SCREAMING_SNAKE 常量
- 强制类型提示: `var speed: float = 100.0`
- 通信: Signal Up, Call Down
- 节点引用: `@onready var player: Player = %Player`
- 脚本结构顺序: class_name → signals → enums → exports → constants → vars → onready → lifecycle → methods

**Godot CLI 参考 (嵌入 Skill):**
```bash
# 场景操作 (通过 godot_operations.gd)
godot --headless --path <project> --script /opt/godot-tools/godot_operations.gd -- \
  create_scene '{"path":"scenes/main.tscn","root_type":"Node2D"}'

godot --headless --path <project> --script /opt/godot-tools/godot_operations.gd -- \
  add_node '{"scene":"scenes/main.tscn","parent":".","type":"CharacterBody2D","name":"Player"}'

# 运行和检查
godot --headless --path <project>                    # 运行 (逻辑层)
godot --headless --check-only --path <project>       # 仅语法检查

# 带渲染运行 + 截图
Xvfb :99 -screen 0 1280x720x24 &
DISPLAY=:99 godot --path <project> &
sleep 3
DISPLAY=:99 import -window root /tmp/screenshot.png  # ImageMagick 截图

# 导出 Web
godot --headless --export-release "Web" export/web/index.html
```

**部署指令 (嵌入 Skill):**
```bash
# 打包导出产物
cd <project>/export/web
tar czf /tmp/game-deploy.tar.gz .

# 上传到游戏广场
curl -s -X POST "http://10.0.1.1:8847/api/games/deploy" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -F "file=@/tmp/game-deploy.tar.gz" \
  -F "title=我的平台跳跃游戏" \
  -F "description=一个简单的 2D 平台跳跃游戏" \
  -F "thumbnail=@/tmp/screenshot.png"
```

**反模式清单 (嵌入 Skill):**

| 反模式 | 替代方案 |
|--------|---------|
| `_process` 中轮询不变数据 | 用信号响应变化 |
| `get_parent().method()` | Signal up 或 group |
| 深路径 `$A/B/C/D` | `%UniqueName` |
| `load()` 在 `_process` 中 | `preload()` 或缓存 |
| 无类型变量 | 始终加类型提示 |
| 魔法数字 | `const` 或 `@export` |
| Autoload 中放游戏逻辑 | Autoload 仅做服务/管理器 |
| `emit_signal("name")` | 类型化: `signal_name.emit()` |
| `node != null` 判断已释放节点 | `is_instance_valid(node)` |

**80/20 法则:**
- 每次生成一个脚本后立即运行测试
- 绝不一次生成 5 个文件再测试
- 要求最简方案: "Write the simplest solution that works"

## 5. Gateway 游戏部署 API

### 5.1 API 设计

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/games/deploy` | 容器上传游戏 (tar.gz + 元数据) |
| GET | `/api/games` | 列出所有已发布游戏 (公开, 无需认证) |
| DELETE | `/api/games/{id}` | 删除游戏 (仅作者或 admin) |

### 5.2 部署 Handler (`gateway/internal/games/handler.go`)

```go
package games

// POST /api/games/deploy
// Content-Type: multipart/form-data
// Fields:
//   file      - tar.gz (index.html + .wasm + .pck)
//   title     - 游戏标题
//   description - 描述 (可选)
//   thumbnail - 封面截图 (可选)

// 流程:
// 1. 校验身份 (auth middleware)
// 2. 生成 game ID (UUID)
// 3. 解压 tar.gz 到 /www/sites/jaco.jingao.club/games-static/{id}/
// 4. 保存 thumbnail 到同目录
// 5. INSERT games 表
// 6. 返回 { id, play_url }

const (
    GamesStaticDir = "/opt/1panel/apps/openresty/openresty/www/sites/jaco.jingao.club/games-static"
    MaxGameSize    = 200 << 20 // 200MB (Web 游戏含 .wasm)
)
```

### 5.3 静态文件路径

```
/opt/1panel/apps/openresty/openresty/www/sites/jaco.jingao.club/
├── games-static/                    # 游戏静态文件 (OpenResty 直接 serve)
│   ├── {game-id-1}/
│   │   ├── index.html
│   │   ├── game.wasm
│   │   ├── game.pck
│   │   └── thumbnail.png
│   └── {game-id-2}/
│       └── ...
```

OpenResty 配置 (1Panel 中添加):
```nginx
location /games-static/ {
    alias /www/sites/jaco.jingao.club/games-static/;
    add_header Cross-Origin-Opener-Policy same-origin;
    add_header Cross-Origin-Embedder-Policy require-corp;
    # Godot Web 导出需要以上两个 CORS 头才能使用 SharedArrayBuffer
}
```

> **重要**: Godot Web 导出需要 `Cross-Origin-Opener-Policy` 和 `Cross-Origin-Embedder-Policy` 响应头，否则 SharedArrayBuffer 不可用，游戏无法运行。

## 6. 数据库

### 6.1 games 表 (`deploy/sql/005_games.sql`)

```sql
-- 游戏广场
CREATE TABLE IF NOT EXISTS games (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id         TEXT NOT NULL REFERENCES users(id),
    author_name     TEXT NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT DEFAULT '',
    thumbnail_url   TEXT DEFAULT '',
    play_url        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'published'
                    CHECK (status IN ('published','hidden','deleted')),
    play_count      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_games_user ON games(user_id);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_created ON games(created_at DESC);

CREATE TRIGGER trg_games_updated
    BEFORE UPDATE ON games FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

## 7. 官网游戏广场

### 7.1 路由 (`website/src/routes/games.rs`)

| 路径 | 说明 | 认证 |
|------|------|------|
| `GET /games` | 游戏大厅 (列表, 分页) | 公开 |
| `GET /games/{id}` | 游戏详情 + iframe 嵌入 | 公开 |

### 7.2 页面设计

**`/games` — 游戏大厅**

```
┌──────────────────────────────────────────────────┐
│  🎮 JAcoworks 游戏广场                            │
│  AI 协作开发的游戏，点击即玩                       │
│                                                   │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐    │
│  │  🖼️ 截图   │ │  🖼️ 截图   │ │  🖼️ 截图   │    │
│  │            │ │            │ │            │    │
│  │  太空射击   │ │  平台跳跃   │ │  贪吃蛇    │    │
│  │  by 张三   │ │  by 李四   │ │  by 王五    │    │
│  │  ▶ 234 次  │ │  ▶ 156 次  │ │  ▶ 89 次   │    │
│  └────────────┘ └────────────┘ └────────────┘    │
│                                                   │
│  ← 上一页  1  2  3  下一页 →                       │
└──────────────────────────────────────────────────┘
```

**`/games/{id}` — 游戏详情页**

```
┌──────────────────────────────────────────────────┐
│  ← 返回广场          太空射击          by 张三    │
├──────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────┐│
│  │                                              ││
│  │                                              ││
│  │         iframe 嵌入游戏 (WebAssembly)        ││
│  │             全屏可玩, 16:9 比例              ││
│  │                                              ││
│  │                                              ││
│  └──────────────────────────────────────────────┘│
│                                                   │
│  这是一个用 Godot 引擎制作的太空射击游戏...        │
│  播放次数: 234  |  发布于: 2026-03-01             │
└──────────────────────────────────────────────────┘
```

iframe 嵌入方式:
```html
<iframe
  src="/games-static/{{ game.id }}/index.html"
  style="width: 100%; aspect-ratio: 16/9; border: none;"
  allow="autoplay; fullscreen; gamepad"
  allowfullscreen>
</iframe>
```

### 7.3 导航集成

`website/templates/base.html` 导航栏添加:
```html
<a href="/games">🎮 游戏广场</a>
```

## 8. 用户体验流程

### 场景 A: OpenClaw 模式 (主要场景)

```
用户: 帮我做个 2D 平台跳跃游戏

Agent: [加载 game-dev-ai skill]
Agent: [bash: godot --version] → ✅ 4.6.1.stable
Agent: 好的！我来帮你创建一个 2D 平台跳跃游戏。

Agent: [bash: mkdir -p ~/game && 初始化 project.godot]
Agent: [write: player.gd — 玩家控制器]
Agent: [bash: godot --headless --script godot_operations.gd -- create_scene ...]
Agent: [write: main.gd — 主场景逻辑]
Agent: [bash: godot --headless --check-only] → 检查语法
Agent: [bash: godot --headless --path ~/game] → 运行测试, 捕获输出
Agent: 基础框架完成！运行无报错。要我继续添加敌人和关卡吗？

用户: 好的，加几个关卡，然后我想分享给朋友玩

Agent: [继续开发...]
Agent: [bash: 截图游戏画面 (Xvfb)]
Agent: [bash: godot --headless --export-release "Web" export/web/index.html]
Agent: [bash: curl POST /api/games/deploy ...]
Agent: 🎮 游戏已发布！你的朋友可以直接访问:
       https://jaco.jingao.club/games/abc123
       在浏览器里就能玩。
```

### 场景 B: 本地模式 (降级，可选)

```
用户: (本地模式) 帮我做个游戏

Agent: [加载 game-dev-ai skill]
Agent: 检测到你在本地模式。要使用 Godot 开发游戏，有两个选择:

       1. 切换到 OpenClaw 模式 (推荐) — Godot 已预装，开发完还能直接发布到游戏广场
       2. 本地安装 Godot: brew install --cask godot

       推荐选择 1，你要切换吗？
```

## 9. 网络链路

### 容器 → Gateway 部署游戏

```
容器 (10.20.20.x)
  → oracle 宿主机路由
    → WireGuard wg1
      → jpdata 中继 (10.0.1.254)
        → jingao (10.0.1.1)
          → Gateway :8847
            → POST /api/games/deploy
              → 写入 /www/sites/jaco.jingao.club/games-static/{id}/
              → INSERT games 表
              → 返回 play_url
```

### 玩家访问游戏

```
玩家浏览器
  → https://jaco.jingao.club/games/{id}
    → Rust 官网 :9527 渲染详情页
      → iframe src="/games-static/{id}/index.html"
        → OpenResty 直接返回静态文件
          → 浏览器内 WebAssembly 运行游戏
```

**jingao 服务器负载**: 仅返回静态文件 (HTML + WASM + PCK)，所有游戏逻辑在玩家浏览器中运行。2C2G 完全无压力。

## 10. godot_operations.gd 脚本

从 [godot-mcp](https://github.com/Coding-Solo/godot-mcp) 项目获取 `scripts/godot_operations.gd`。
该文件是一个 Godot headless 脚本，接收 JSON 参数执行操作:

- `create_scene` — 创建 .tscn 文件
- `add_node` — 修改场景树
- `load_sprite` — 设置纹理
- `save_scene` — 保存场景
- `export_mesh_library` — 导出 MeshLibrary
- `get_uid` / `update_uids` — UID 管理 (Godot 4.4+)

**许可证**: MIT，可直接预装到容器模板。
**调用方式**: `godot --headless --path <project> --script /opt/godot-tools/godot_operations.gd -- <operation> <params_json>`

## 11. 实施步骤

### Phase 1 — Skill (1-2 小时，零代码改动)

- [ ] 创建 `vm-agent/skills/开发/game-dev-ai/SKILL.md`
- [ ] 创建 `references/godot-best-practices.md` (GDScript 编码规范)
- [ ] 创建 `references/godot-cli-reference.md` (Godot headless CLI 命令参考)
- [ ] 创建 `references/anti-patterns.md` (反模式清单)
- [ ] 测试: 本地 Agent 新建会话 → 确认 skill 被发现

### Phase 2 — 容器模板 (1-2 小时，oracle 服务器操作)

- [ ] 从 godot-mcp 获取 `godot_operations.gd` 放入 `vm-agent/scripts/`
- [ ] 编写 `deploy/openclaw/setup-godot.sh`
- [ ] SSH 到 oracle (10.0.1.3) 执行安装脚本更新 `tpl-openclaw`
- [ ] 验证: `lxc exec tpl-openclaw -- godot --version` → 4.6.1.stable
- [ ] 验证: Web Export Template 已安装
- [ ] 验证: `Xvfb :99 &` 可正常启动

### Phase 3 — Gateway 游戏部署 API (2-3 小时)

- [ ] 创建 `deploy/sql/005_games.sql`
- [ ] 在 jingao 执行 SQL 建表
- [ ] 创建 `gateway/internal/games/handler.go`
- [ ] 修改 `gateway/cmd/gateway/main.go` — 注册路由
- [ ] 配置 OpenResty — `/games-static/` 静态目录 + COOP/COEP 头
- [ ] 测试: curl 上传 → 文件落盘 → 返回 URL

### Phase 4 — 官网游戏广场 (2-3 小时)

- [ ] 创建 `deploy/sql/005_games.sql` (如 Phase 3 未做)
- [ ] 创建 `website/src/models/game.rs`
- [ ] 创建 `website/src/routes/games.rs` (列表 + 详情)
- [ ] 创建 `website/templates/games/gallery.html`
- [ ] 创建 `website/templates/games/play.html`
- [ ] 修改 `website/src/routes/mod.rs` — `pub mod games`
- [ ] 修改 `website/templates/base.html` — 导航栏加链接
- [ ] 测试: 浏览 /games → 列表展示 → 点击 → iframe 可玩

### Phase 5 — 端到端验证

- [ ] OpenClaw 容器内: 创建 Godot 项目 → 编写脚本 → 运行 → 导出 Web → 部署
- [ ] 浏览器: 访问游戏广场 → 看到新游戏 → 点击玩
- [ ] 验证: COOP/COEP 头正确 (SharedArrayBuffer 可用)
- [ ] 验证: 多用户各自发布互不干扰

## 12. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Godot ARM64 headless 某些操作不稳定 | 超时保护 (30s)，失败时 Agent 直接写 .tscn 文件 (纯文本格式) |
| Web Export Template 体积大 (~800MB) 占容器空间 | 模板共享层，所有容器复用同一份 |
| 导出的 Web 游戏体积大 (.wasm ~30MB) | jingao 开启 gzip，实际传输 ~8MB |
| SharedArrayBuffer 需要 COOP/COEP 头 | OpenResty 配置强制添加 |
| godot_operations.gd 不兼容新版 Godot | 跟踪上游 godot-mcp 更新，版本锁定 4.6.x |
| 容器内 Godot 占内存 (~200MB headless) | oracle 22GB RAM，可支撑 ~50 并发容器 |
| 恶意用户上传非游戏文件 | Gateway 校验 tar.gz 中必须含 index.html + .wasm |

## 13. OpenResty 配置要点

```nginx
# jaco.jingao.club 站点配置中添加

# 游戏静态文件 (Godot Web Export)
location /games-static/ {
    alias /www/sites/jaco.jingao.club/games-static/;

    # Godot Web Export 必需的安全头 (SharedArrayBuffer)
    add_header Cross-Origin-Opener-Policy same-origin always;
    add_header Cross-Origin-Embedder-Policy require-corp always;

    # 缓存 (.wasm 和 .pck 不常变)
    location ~* \.(wasm|pck)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
        add_header Cross-Origin-Opener-Policy same-origin always;
        add_header Cross-Origin-Embedder-Policy require-corp always;
    }

    # gzip (.wasm 压缩效果显著)
    gzip on;
    gzip_types application/wasm application/javascript text/html;
}
```

## 14. 后续扩展

- **游戏评分/评论**: games 表加 rating 字段，或独立 game_reviews 表
- **项目模板**: Skill 内置 2D/3D 项目脚手架，一键创建 (2D-platformer, top-down-shooter 等)
- **资源生成**: 集成 AI 图像生成 (grok-imagine) 自动生成 sprite/texture
- **多人游戏**: Godot 支持 WebRTC，Web 导出可实现浏览器多人对战
- **Admin 管理**: 官网后台加游戏审核/下架功能
- **Web 游戏 fallback**: 对偏好前端的用户，Skill 也可引导用 Phaser.js/Three.js 路线
- **本地模式 Extension**: 如需求强烈，可补充 `vm-agent/src/extensions/godot.ts` 给本地用户用
