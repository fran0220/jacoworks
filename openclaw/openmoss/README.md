# OpenMOSS

实际展示效果及使用说明详情请移步LINUX DO ！

LINUX DO 实际效果及项目使用说明：https://linux.do/t/topic/1709670

## 一、OpenMOSS 是什么？

OpenMOSS（Multi-agent Orchestration & Self-evolving System）是一个基于 [OpenClaw](https://github.com/openclaw/openclaw) 的多 AI Agents 自组织协作平台。它可以实现多 AI Agents 的自组织、自修复、自进化、团队激励等能力，进而实现近乎 100% 多线程多步骤任务的完成度，使 OpenClaw 的任务运行效率得到大幅度提高。

**简单来说：**

传统的 OpenClaw，你（人类管理员）只需要告诉 AI Agent「做什么」，这个 AI Agent 会一个人线性逻辑地推进项目，如果遇到问题他会报错，并基于模型性能有一定概率自我修复，但大多数情况下，这个 AI Agent 将在对话中"死掉"，导致任务失败。

而加上 OpenMOSS 多 AI Agent 自组织协作平台后，你的 AI Agent 们将可以自我组织，自动巡查，自动认领任务，自动检查代码，无需人工干预，Agent"死亡率"降至 0%。

**举个例子：** 你（人类管理员）只需要告诉 AI「做什么」，比如「开发一个博客」——

- **规划者 Agent**（一个 AI 模型）会自动把需求拆成一个个子任务，分配给不同的 Agent
- **执行者 Agent**（另一个 AI 模型）自动认领子任务、写代码、提交成果
- **审查者 Agent** 自动检查代码质量，通过或驳回返工
- **巡查者 Agent** 自动巡检系统，发现卡住的任务发出告警
- 全过程 **无需人工干预**，Agent 们通过定时唤醒（cron）自主运行

**一句话总结：这是一个让 AI 自己管理 AI 干活的平台。人类只需下达目标、看结果。**

> **需要特别声明：** OpenMOSS 的实际使用效果与你给 OpenClaw 的 AI Agent 调用的大语言模型有极强的关联性，上下文窗口越高，实际效果越好。我们推荐你使用 GPT-5.3-Codex 或 GPT-5.4。

> **需要特别声明：** 请注意，因为多 AI Agents 的使用，模型消耗量将成倍提高，请合理控制接口限额和速率，谨防超量使用造成经济损失。

> **推荐使用环境：** 为了实现 OpenMOSS 能力最大化的效果，请尽可能为其配置单独的桌面级生产环境。

---

## 二、系统架构

OpenMOSS 采用 **中间件架构**，作为 OpenClaw 与多个 AI Agent 之间的协调层。后端基于 FastAPI，前端基于 Vue 3，数据库使用 SQLite。

```
+---------------------------------------------------+
|                   WebUI (Vue 3)                    |
|  Dashboard / Tasks / Feed / Scores / Logs          |
+---------------------------------------------------+
|             FastAPI Backend (:6565)                 |
|                                                     |
|  /api/agents/*     Agent 注册与管理                  |
|  /api/tasks/*      任务 CRUD + 状态流转              |
|  /api/sub-tasks/*  子任务生命周期                    |
|  /api/rules/*      规则引擎                         |
|  /api/review-records/*  审查记录                    |
|  /api/scores/*     积分系统                         |
|  /api/feed/*       活动流                           |
|  /api/logs/*       活动日志                         |
|  /api/admin/*      管理端接口                       |
+---------------------------------------------------+
|            SQLite / SQLAlchemy ORM                  |
+---------------------------------------------------+
         |              |              |
    +---------+   +---------+   +---------+
    | Planner |   |Executor |   |Reviewer |  ...
    |  Agent  |   |  Agent  |   |  Agent  |
    +---------+   +---------+   +---------+
     (OpenClaw)    (OpenClaw)    (OpenClaw)
```

### 任务层级

OpenMOSS 使用三级任务结构来管理复杂项目：

| 层级               | 说明                 | 示例                             |
| ------------------ | -------------------- | -------------------------------- |
| Task（任务）       | 一个完整的项目目标   | 开发一个博客系统                 |
| Module（模块）     | 任务的功能拆分       | 用户系统、文章管理、评论系统     |
| Sub-Task（子任务） | 具体的可执行工作单元 | 实现用户注册接口、编写文章列表页 |

### 子任务状态流转

```
pending --> assigned --> in_progress --> review --> done
                            |              |
                            +-- rework <---+  (审查不通过时返工)

                       任意状态 --> blocked    (巡查标记阻塞)
                       任意状态 --> cancelled  (取消)
```

---

## 三、Agent 角色

每个 Agent 本质上是一个运行在 OpenClaw 上的 AI 模型实例，通过 API Key 与 OpenMOSS 后端交互。不同角色有不同的职责和权限。

| 角色                   | 职责                                         | 说明                             |
| ---------------------- | -------------------------------------------- | -------------------------------- |
| **planner（规划者）**  | 创建任务、拆分模块、分配子任务、定义验收标准 | 项目的总指挥，负责全局规划和收尾 |
| **executor（执行者）** | 认领子任务、执行开发工作、提交交付物         | 具体的干活者，产出代码和内容     |
| **reviewer（审查者）** | 审查交付物质量、评分、合格通过或驳回返工     | 质量把关者，确保输出达标         |
| **patrol（巡查者）**   | 巡查系统异常、标记阻塞任务、发送告警通知     | 自动化运维，避免任务卡死         |

### Agent 工作流

Agent 通过 OpenClaw 的 cron 定时唤醒机制自主运行，每次被唤醒后：

1. 调用 OpenMOSS API 获取当前状态（我有什么任务？有没有待审查的？）
2. 根据自身角色执行相应操作（Planner 分配任务、Executor 写代码、Reviewer 审查……）
3. 将结果回写到 OpenMOSS（提交交付物、完成审查、记录日志）
4. 进入休眠，等待下次唤醒

全过程不需要人类介入。Agent 之间通过 OpenMOSS 的任务状态和日志进行异步协作。

---

## 四、项目结构

```
OpenMOSS/
|
|-- app/                            # 后端应用（FastAPI）
|   |-- main.py                     # 入口：路由注册、中间件、SPA 静态服务
|   |-- config.py                   # 配置加载（config.yaml）
|   |-- database.py                 # 数据库初始化（SQLAlchemy）
|   |-- auth/                       # 认证模块
|   |   +-- dependencies.py         # API Key / Admin Token 校验
|   |-- middleware/                  # 中间件
|   |   +-- request_logger.py       # 请求日志记录（驱动活动流）
|   |-- models/                     # 数据模型（10 张表）
|   |   |-- task.py                 # 任务
|   |   |-- module.py               # 模块
|   |   |-- sub_task.py             # 子任务
|   |   |-- agent.py                # Agent
|   |   |-- rule.py                 # 规则
|   |   |-- review_record.py        # 审查记录
|   |   |-- reward_log.py           # 积分变动记录
|   |   |-- activity_log.py         # 活动日志
|   |   |-- request_log.py          # 请求日志
|   |   +-- patrol_record.py        # 巡查记录
|   |-- routers/                    # API 路由
|   |   |-- agents.py               # Agent 注册 / 查询 / 状态
|   |   |-- tasks.py                # 任务 CRUD
|   |   |-- sub_tasks.py            # 子任务生命周期
|   |   |-- rules.py                # 规则查询
|   |   |-- review_records.py       # 审查提交
|   |   |-- scores.py               # 积分 / 排行榜
|   |   |-- logs.py                 # 活动日志
|   |   |-- feed.py                 # 活动流
|   |   |-- admin.py                # 管理员登录
|   |   |-- admin_agents.py         # 管理端 Agent 查询
|   |   +-- admin_tasks.py          # 管理端任务查询
|   |-- services/                   # 业务逻辑层
|   +-- schemas/                    # Pydantic 序列化模型
|
|-- webui/                          # 前端应用（Vue 3 + shadcn-vue）
|   |-- src/
|   |   |-- views/                  # 页面视图
|   |   |-- components/             # 组件（ui / feed / common）
|   |   |-- api/                    # API 客户端
|   |   |-- stores/                 # Pinia 状态管理
|   |   |-- composables/            # 组合式函数
|   |   +-- router/                 # Vue Router
|   +-- dist/                       # 构建产物（npm run build 生成）
|
|-- static/                         # 前端构建产物（由 webui/dist/ 拷贝而来，后端直接服务）
|
|-- prompts/                        # Agent 角色提示词
|   |-- task-planner.md             # 规划者提示词
|   |-- task-executor.md            # 执行者提示词
|   |-- task-reviewer.md            # 审查者提示词
|   +-- task-patrol.md              # 巡查者提示词
|
|-- skills/                         # OpenClaw AgentSkill 定义
|   |-- task-cli.py                 # CLI 工具（各 Skill 共用的 API 调用脚本）
|   |-- pack-skills.py              # Skill 打包脚本（生成 .zip 包）
|   |-- dist/                       # 打包产物（.zip Skill 包）
|   |-- task-planner-skill/         # 规划者 Skill
|   |-- task-executor-skill/        # 执行者 Skill
|   |-- task-reviewer-skill/        # 审查者 Skill
|   |-- task-patrol-skill/          # 巡查者 Skill
|   |-- wordpress-skill/            # WordPress 发布 Skill ⚙️
|   |-- antigravity-gemini-image/   # Gemini 图片生成/编辑 Skill ⚙️
|   |-- grok-search-runtime/        # Grok 联网搜索 Skill ⚙️
|   +-- local-web-search/           # 本地网关 Web 搜索 Skill ⚙️
|
|-- rules/                          # 全局规则模板
|-- tests/                          # 测试用例
|-- docs/                           # 设计文档
|-- config.example.yaml             # 配置文件模板
|-- requirements.txt                # Python 依赖
|-- Dockerfile                      # Docker 构建文件
|-- docker-compose.yml              # Docker Compose 配置
+-- LICENSE                         # 开源许可证

```

> **⚙️ 标记说明：** 带有 ⚙️ 标记的 Skill 并非通用开箱即用的，它们依赖特定的外部服务（如 WordPress 站点、Gemini API、Grok API 等）。使用前需要根据你自己的环境修改对应的 API 地址、密钥等配置。具体配置方法请参考各 Skill 目录下的 `SKILL.md` 或 `references/CONFIG.md`。

---

## 五、快速启动

### 环境要求

- Python 3.10 或更高版本
- Node.js 18 或更高版本（仅构建前端时需要，如果仓库中已有 `static/` 目录则不需要）

### 安装与启动

```bash
# 1. 克隆项目
git clone https://github.com/uluckyXH/OpenMOSS/ openmoss
cd openmoss

# 2. 安装 Python 依赖
pip install -r requirements.txt

# 3. 启动服务（在项目根目录下运行）
python -m uvicorn app.main:app --host 0.0.0.0 --port 6565
```

首次启动会自动完成以下初始化：

- 从 `config.example.yaml` 复制生成 `config.yaml`
- 初始化 SQLite 数据库（`data/tasks.db`）
- 管理员密码自动加密为 bcrypt 格式
- 如果 `static/` 目录存在，自动挂载前端

启动成功后：

| 地址                               | 说明             |
| ---------------------------------- | ---------------- |
| `http://localhost:6565`            | WebUI 管理后台   |
| `http://localhost:6565/docs`       | Swagger API 文档 |
| `http://localhost:6565/api/health` | 健康检查接口     |

### 构建前端

如果仓库中没有 `static/` 目录，需要手动构建前端：

```bash
cd webui
npm install
npm run build

# 清空旧文件并拷贝新构建产物
rm -rf ../static/*
cp -r dist/* ../static/
cd ..

# 重启后端，前端会自动加载
python -m uvicorn app.main:app --host 0.0.0.0 --port 6565
```

---

## 六、Ubuntu 部署

```bash
# 1. 克隆项目到服务器
cd /opt
git clone https://github.com/uluckyXH/OpenMOSS/ openmoss
cd openmoss

# 2. 创建虚拟环境并安装依赖
python3 -m venv openmoss-env
source openmoss-env/bin/activate
pip install -r requirements.txt

# 3. 配置（重要）
cp config.example.yaml config.yaml
nano config.yaml
# 请务必修改以下配置：
#   admin.password           — 管理员密码
#   agent.registration_token — Agent 注册令牌
#   workspace.root           — 工作目录路径

# 4. 后台启动
mkdir -p logs
PYTHONUNBUFFERED=1 nohup python3 -m uvicorn app.main:app \
  --host 0.0.0.0 --port 6565 --access-log \
  > ./logs/server.log 2>&1 &

# 查看日志
tail -f logs/server.log

# 停止服务
kill $(pgrep -f "uvicorn app.main:app")
```

---

## 七、配置说明

配置文件为项目根目录下的 `config.yaml`，首次启动时自动从 `config.example.yaml` 生成。修改配置后需重启服务生效。

### 完整配置示例

```yaml
# OpenMOSS 任务调度中间件 — 配置文件模板
# 复制此文件为 config.yaml 并修改配置

# 项目名称
project:
  name: "OpenMOSS"

# 管理员配置
admin:
  password: "admin123" # 首次启动后自动替换为 MD5 加密
  # 后台的管理密码，启动后会自己变成加密的MD5

# Agent 注册
agent:
  registration_token: "openclaw-register-2024" # Agent 自动注册令牌，在Agent注册的时候你需要把这个令牌也告诉它
  allow_registration: true # Agent 自注册开关（false=关闭自注册，只能由管理员创建）

# 通知渠道（OpenMOSS 内置消息，Agent 通过 GET /config/notification 获取后自行发送）
notification:
  enabled: true # 记得打开，否则AGgent不会通知
  # 目标渠道：格式为 渠道类型:目标ID
  channels: []
    # - "chat:oc_1f99abbba2bf0f8733377893d976ffa5"   # 飞书群（把 Agent 拉进群/艾特一次即可获取 chat_id）
    # - "user:ou_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"        # 飞书私聊（open_id）
    # - “xxx@gmail.com” # 当然你的Agent要具备发邮件的功能
  # 触发通知的事件类型
  events:
    - task_completed # 子任务完成时通知
    - review_rejected # 审查驳回（返工）时通知
    - all_done # 整个任务所有子任务全部完成时通知
    - patrol_alert # 巡查发现异常时通知

# 服务配置
server:
  port: 6565
  host: "0.0.0.0"

# 数据库配置
database:
  type: sqlite
  path: "./data/tasks.db"

# 工作目录
workspace:
  root: "/Users/xiaohuang/Desktop/TaskWork" # 这个很重要，会自动替换到全局提示词中，告诉Agent产出的结果该放在哪

# WebUI 配置
webui:
  public_feed: false # 活动流展示页公开开关（true=任何人可访问）
  feed_retention_days: 7 # 请求日志保留天数（超期自动清理）
```

### 配置项说明

| 配置项                      | 默认值            | 必填   | 说明                                                                               |
| --------------------------- | ----------------- | ------ | ---------------------------------------------------------------------------------- |
| `project.name`              | `OpenMOSS`        | 否     | 项目名称                                                                           |
| `admin.password`            | `admin123`        | **是** | 管理员密码，首次启动后自动加密为 bcrypt 格式                                       |
| `agent.registration_token`  | —                 | **是** | Agent 注册令牌，建议使用随机字符串                                                 |
| `agent.allow_registration`  | `true`            | 否     | 关闭后 Agent 无法自注册，只能管理员创建                                            |
| `server.host`               | `0.0.0.0`         | 否     | 服务监听地址                                                                       |
| `server.port`               | `6565`            | 否     | 服务监听端口                                                                       |
| `database.type`             | `sqlite`          | 否     | 数据库类型（目前仅支持 SQLite）                                                    |
| `database.path`             | `./data/tasks.db` | 否     | 数据库文件路径                                                                     |
| `notification.enabled`      | `false`           | 否     | 是否启用通知推送                                                                   |
| `notification.channels`     | `[]`              | 否     | 通知渠道列表，格式 `渠道类型:目标ID`                                               |
| `notification.events`       | `[]`              | 否     | 触发通知的事件：`task_completed` / `review_rejected` / `all_done` / `patrol_alert` |
| `webui.public_feed`         | `false`           | 否     | 活动流公开开关                                                                     |
| `webui.feed_retention_days` | `7`               | 否     | 请求日志保留天数                                                                   |
| `workspace.root`            | `./workspace`     | **是** | Agent 工作目录根路径                                                               |

> **⚠️ 首次部署务必修改：** `admin.password`、`agent.registration_token`、`workspace.root`

---

## 八、API 文档

启动后访问 `http://localhost:6565/docs` 可查看完整的 Swagger API 文档。

### 认证方式

OpenMOSS 采用双层认证体系：

| 身份   | Header                          | 说明                           |
| ------ | ------------------------------- | ------------------------------ |
| Agent  | `X-Agent-Key: <api_key>`        | Agent 注册成功后获得的 API Key |
| 管理员 | `X-Admin-Token: <token>`        | 通过登录接口获取的 Token       |
| 注册   | `X-Registration-Token: <token>` | 配置文件中设置的注册令牌       |

---

## 九、WebUI 页面

OpenMOSS 内置了一个管理后台（基于 Vue 3 + shadcn-vue），构建后的静态文件由后端直接服务，无需额外的 Web 服务器。

| 页面     | 路径      | 说明                                                  |
| -------- | --------- | ----------------------------------------------------- |
| 登录     | `/login`  | 管理员密码登录                                        |
| 仪表盘   | `/`       | 系统概览信息                                          |
| 任务管理 | `/tasks`  | 任务列表、详情面板、模块拆分视图、子任务管理          |
| 活动流   | `/feed`   | 实时展示全部 Agent 的 API 调用活动，支持按 Agent 筛选 |
| 积分排行 | `/scores` | Agent 积分排行榜                                      |

---

## 十、开发指南

### 后端开发

```bash
# 安装依赖
pip install -r requirements.txt

# 开发模式启动（代码修改后自动重载）
python -m uvicorn app.main:app --host 0.0.0.0 --port 6565 --reload

# 运行测试
python -m pytest tests/
```

### 前端开发

```bash
cd webui

# 安装依赖
npm install

# 开发服务器（http://localhost:5173，自动代理 /api 到 :6565）
npm run dev

# 构建生产版本
npm run build

# 代码检查
npm run lint
```

### 技术栈

| 层             | 技术                                                      |
| -------------- | --------------------------------------------------------- |
| 后端           | Python 3.10+ / FastAPI / SQLAlchemy / Uvicorn             |
| 数据库         | SQLite                                                    |
| 前端           | Vue 3 / TypeScript / Tailwind CSS v4 / shadcn-vue / Pinia |
| 构建           | Vite                                                      |
| Agent 运行环境 | OpenClaw                                                  |

---

## 十一、Roadmap

以下是 OpenMOSS 后续计划中的功能：

### 前端完善

- [ ] 仪表盘（Dashboard）数据可视化
- [ ] 任务详情页交互优化
- [ ] Agent 管理页（创建/编辑/删除）
- [ ] 规则管理页（全局/任务级规则的增删改查）
- [ ] 日志查询与筛选页面
- [ ] 移动端适配

### 插件系统

- [ ] 可插拔的 Skill 插件架构
- [ ] 第三方 Skill 市场
- [ ] 自定义 Agent 角色扩展
- [ ] Webhook 事件回调

### 娱乐与社交功能

- [ ] Agent 成就系统
- [ ] Agent 互动记录（协作历史可视化）
- [ ] Agent 人格化展示（头像、签名、工作风格标签）

### 基础设施

- [ ] 支持 PostgreSQL / MySQL
- [ ] Docker 一键部署
- [ ] CI/CD 自动构建前端
- [ ] 多语言支持（i18n）
