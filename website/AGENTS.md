# Website — Rust 官网 + 管理后台

> Axum :9527, jingao 同机, OpenResty 反代 jaco.jingao.club。公开页面、文档、反馈、游戏画廊、管理后台和 Tauri 更新 API。

## 代码结构

```
src/
  main.rs                      Axum 入口, 路由注册, admin 登录/登出
  config.rs                    TOML 配置 (website.toml)
  db.rs                        sqlx PgPool 工厂
  error.rs                     AppError → IntoResponse
  auth.rs                      Admin cookie 认证 + AdminUser 提取器 (bcrypt + sha256 双格式)
  models/                      user, invite, release, feedback, audit, session, auth_session, game, skill
  routes/
    pages.rs                   首页 / 下载 / 关于
    docs.rs                    文档渲染 (Markdown → HTML)
    feedback.rs                反馈表单 (公开)
    games.rs                   游戏画廊 (gallery + play 页面)
    update.rs                  Tauri Updater API (GET /api/update/:target/:arch/:version)
    admin/
      mod.rs                   Admin 路由组
      dashboard.rs             统计仪表盘
      users.rs                 用户 CRUD
      invites.rs               激活码管理 (创建/列表/撤销)
      releases.rs              版本发布 (CRUD + 安装包上传)
      containers.rs            容器管理 (代理 Gateway API)
      feedback.rs              反馈管理 (回复/状态变更)
      audit.rs                 审计日志 (分页+筛选)
      settings.rs              系统设置 (LLM 密钥管理, 网关/DB 状态, 模型列表)
      skills.rs                技能管理 (上传/列表/删除)
  services/
    docs.rs                    Markdown 解析 + TOC + 导航树
    gateway.rs                 Gateway Admin API HTTP 客户端

templates/                     Askama HTML 模板
  base.html                    公开页面布局 (Tailwind + HTMX CDN)
  pages/{index,download,about}.html
  docs/{layout,index}.html     文档三栏布局
  feedback.html                反馈表单
  games/{gallery,play}.html    游戏画廊 + 游戏播放页
  admin/
    login.html                 管理登录 (独立布局)
    layout.html                管理后台布局 (深色侧边栏)
    {dashboard,users,invites,releases,release_edit}.html
    {containers,feedback_list,audit,settings,skills}.html

static/css/style.css           自定义样式
static/js/app.js               平台检测 + Toast + HTMX 事件
content/                       Markdown 文档源文件
```

## 环境变量

**website.toml** (env override `WEBSITE_*`):
```toml
cookie_secret = "32-byte-hex-string"
[server]
host = "0.0.0.0"
port = 9527
[database]
url = "postgresql://...@127.0.0.1:5432/jacoworks"
[gateway]
url = "http://localhost:8847"
admin_token = "your-admin-token"
[site]
name = "JAcoworks"
description = "企业 AI 协同办公平台"
base_url = "https://jaco.jingao.club"
```

## 测试

```bash
# Rust smoke tests (验证关键路由可达)
cargo test
```

`tests/smoke_routes.rs` — 覆盖 10 条关键路由的 HTTP 状态码检查。

## 开发规范

- **Rust Axum + Askama + sqlx + pulldown-cmark**
- **模板**: Askama HTML 模板 + Tailwind CDN + HTMX
- **共享 PostgreSQL**: 与 Gateway 共享 jingao 本地数据库
- **容器操作代理**: 容器管理通过 Gateway Admin API 代理
- 开发: `make dev-website` → localhost:9527
- 部署: `make deploy-website` → SSH jingao 远程编译 + 重启
