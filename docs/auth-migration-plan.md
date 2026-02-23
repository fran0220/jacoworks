# JAcoworks 认证系统迁移实施方案

> SQLite 自建 JWT → PostgreSQL + Better Auth 微服务
> 
> 状态：**设计完成，待实施**

---

## 1. 架构变更概览

### 1.1 现有架构

```
桌面端 → POST /api/auth/login (用户名+密码)
       → Go 网关自建 JWT (golang-jwt)
       → Bearer token 鉴权所有 API
       → SQLite 存储 (users/sessions/audit_logs 共用 data/jacoworks.db)
```

### 1.2 目标架构

```
桌面端 ──登录──→ Better Auth 微服务 (:3100)
                  │ ├─ 飞书 SSO (内部员工)
                  │ ├─ 激活码登录 (外部用户)
                  │ └─ 签发 session token
                  ↓
桌面端 ──业务──→ Go 网关 (:8090)
                  │ ├─ 验证 BA session (HTTP 调用 BA /api/auth/get-session)
                  │ ├─ 查 user→container 映射 (PostgreSQL)
                  │ └─ 透传 → vm-agent (SSE)
                  ↓
              PostgreSQL (Railway)  ← BA + 网关共用
```

### 1.3 数据流对比

| 步骤 | 旧 | 新 |
|------|-----|-----|
| 登录 | 桌面端 → 网关 loginHandler → bcrypt 验证 → 签 JWT | 桌面端 → BA 客户端 → BA 服务验证 → 签发 session |
| 鉴权 | 解析 JWT claims (user_id, username, role) | 网关调 BA `/api/auth/get-session` 获取 user 对象 |
| 用户创建 | 网关 admin API → SQLite insert | 管理员生成激活码 → 用户自助激活 → BA 创建用户 |
| 数据库 | SQLite (modernc.org/sqlite) | PostgreSQL 17 (pgx/v5) |

---

## 2. 新增：auth-service（Better Auth 微服务）

### 2.1 目录结构

```
JAcoworks/
├── auth-service/              # 新增
│   ├── src/
│   │   ├── index.ts           # Express server (:3100)
│   │   ├── auth.ts            # Better Auth 配置（核心）
│   │   └── invite.ts          # 激活码验证逻辑
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
```

### 2.2 auth.ts — Better Auth 配置

```typescript
import { betterAuth } from "better-auth";
import { genericOAuth, admin } from "better-auth/plugins";
import pg from "pg";

export const auth = betterAuth({
  database: new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  }),

  // 基础认证：邮箱密码（激活码流程后设置）
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,  // 激活码已验证身份
  },

  // 飞书 SSO
  plugins: [
    genericOAuth({
      config: [{
        providerId: "feishu",
        clientId: process.env.FEISHU_CLIENT_ID!,
        clientSecret: process.env.FEISHU_CLIENT_SECRET!,
        discoveryUrl: "https://open.feishu.cn/.well-known/openid-configuration",
        // 或手动指定：
        // authorizationUrl: "https://open.feishu.cn/open-apis/authen/v1/authorize",
        // tokenUrl: "https://open.feishu.cn/open-apis/authen/v1/oidc/access_token",
        // userInfoUrl: "https://open.feishu.cn/open-apis/authen/v1/user_info",
      }],
    }),
    admin(),  // 管理员 API（创建/禁用用户）
  ],

  // Session 配置
  session: {
    expiresIn: 60 * 60 * 24 * 7,  // 7 天
    updateAge: 60 * 60 * 24,        // 每天刷新
  },

  // 用户自定义字段
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "user" },
    },
  },

  // 安全
  trustedOrigins: [
    "http://localhost:1420",       // Tauri dev
    "tauri://localhost",           // Tauri production
    "http://192.168.31.162:8090",  // Go 网关
  ],
});
```

### 2.3 index.ts — HTTP 服务

```typescript
import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth";
import { activateRoute } from "./invite";

const app = express();
app.use(express.json());

// Better Auth 处理所有 /api/auth/* 路由
app.all("/api/auth/*", toNodeHandler(auth));

// 激活码验证端点
app.post("/api/activate", activateRoute(auth));

// 健康检查
app.get("/health", (_, res) => res.json({ ok: true }));

app.listen(3100, () => console.log("auth-service listening on :3100"));
```

### 2.4 invite.ts — 激活码逻辑

```typescript
import type { Auth } from "better-auth";
import pg from "pg";

export function activateRoute(auth: Auth) {
  return async (req: Request, res: Response) => {
    const { code, username, password } = req.body;

    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    // 1. 验证激活码
    const result = await pool.query(
      `SELECT * FROM invite_codes 
       WHERE code = $1 
         AND used_count < max_uses 
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [code]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "激活码无效或已过期" });
    }

    const invite = result.rows[0];

    // 2. 通过 Better Auth admin API 创建用户
    const user = await auth.api.signUpEmail({
      body: { email: `${username}@jacoworks.local`, password, name: username },
    });

    // 3. 标记激活码已使用
    await pool.query(
      `UPDATE invite_codes SET used_count = used_count + 1 WHERE code = $1`,
      [code]
    );
    await pool.query(
      `INSERT INTO invite_code_usages (code, user_id) VALUES ($1, $2)`,
      [code, user.user.id]
    );

    return res.json({ success: true, user: user.user });
  };
}
```

### 2.5 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 | `postgresql://postgres:xxx@trolley.proxy.rlwy.net:28177/railway` |
| `BETTER_AUTH_SECRET` | 加密密钥 (≥32字符) | 随机生成 |
| `BETTER_AUTH_URL` | BA 服务地址 | `http://192.168.31.162:3100` |
| `FEISHU_CLIENT_ID` | 飞书应用 ID | 飞书开放平台获取 |
| `FEISHU_CLIENT_SECRET` | 飞书应用密钥 | 飞书开放平台获取 |

### 2.6 部署

```ini
# deploy/auth-service/auth-service.service
[Unit]
Description=JAcoworks Auth Service (Better Auth)
After=network.target

[Service]
Type=simple
User=agent
WorkingDirectory=/opt/jacoworks/auth-service
EnvironmentFile=/opt/jacoworks/auth-service/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

---

## 3. 改造：Go 网关

### 3.1 需要删除的代码

| 文件/模块 | 原因 |
|-----------|------|
| `internal/auth/middleware.go` | **重写**：JWT 解析 → 调 BA get-session |
| `main.go: loginHandler()` | **删除**：登录由 BA 接管 |
| `main.go: createUserHandler()` | **重写**：不再创建密码，改为生成激活码 + 分配容器 |
| `internal/user/store.go` | **重写**：SQLite → PostgreSQL (pgx)，删除密码相关方法 |
| `internal/audit/logger.go` | **重写**：SQLite → PostgreSQL |
| `go.mod: modernc.org/sqlite` | **删除**：不再需要 |
| `go.mod: golang.org/x/crypto/bcrypt` | **删除**：密码哈希由 BA 管理 |
| `go.mod: golang-jwt/jwt` | **保留**：admin token 旁路仍需要，或也可删除 |

### 3.2 需要新增的代码

| 文件 | 说明 |
|------|------|
| `internal/auth/middleware.go` | 重写：调 BA `/api/auth/get-session` 验证 |
| `internal/store/pg.go` | 新建：pgx 连接池 + containers/chat_sessions/invite_codes CRUD |
| `internal/store/containers.go` | 容器映射 CRUD |
| `internal/store/sessions.go` | 聊天会话 CRUD (原 user.Store 会话部分) |
| `internal/store/invites.go` | 激活码 CRUD |

### 3.3 auth/middleware.go 重写

```go
package auth

import (
    "context"
    "encoding/json"
    "fmt"
    "net/http"
    "time"
)

type UserInfo struct {
    ID       string `json:"id"`
    Name     string `json:"name"`
    Email    string `json:"email"`
    Role     string `json:"role"`
}

type SessionResponse struct {
    Session struct {
        ID        string `json:"id"`
        UserID    string `json:"userId"`
        ExpiresAt string `json:"expiresAt"`
    } `json:"session"`
    User UserInfo `json:"user"`
}

type Middleware struct {
    authServiceURL string
    adminToken     string
    httpClient     *http.Client
}

func NewMiddleware(authServiceURL, adminToken string) *Middleware {
    return &Middleware{
        authServiceURL: authServiceURL,
        adminToken:     adminToken,
        httpClient: &http.Client{Timeout: 5 * time.Second},
    }
}

func (m *Middleware) Authenticate(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        token := extractBearerToken(r)
        if token == "" {
            // 尝试从 cookie 获取 (BA 浏览器客户端)
            cookie, err := r.Cookie("better-auth.session_token")
            if err == nil {
                token = cookie.Value
            }
        }

        if token == "" {
            writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing auth"})
            return
        }

        // Admin token 旁路
        if token == m.adminToken && m.adminToken != "" {
            ctx := context.WithValue(r.Context(), UserContextKey, &UserInfo{
                ID: "admin", Name: "admin", Role: "admin",
            })
            next.ServeHTTP(w, r.WithContext(ctx))
            return
        }

        // 调用 Better Auth 验证 session
        req, _ := http.NewRequest("GET", m.authServiceURL+"/api/auth/get-session", nil)
        req.Header.Set("Authorization", "Bearer "+token)
        // 也传递 cookie（支持浏览器客户端）
        for _, c := range r.Cookies() {
            req.AddCookie(c)
        }

        resp, err := m.httpClient.Do(req)
        if err != nil || resp.StatusCode != 200 {
            writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid session"})
            return
        }
        defer resp.Body.Close()

        var session SessionResponse
        if err := json.NewDecoder(resp.Body).Decode(&session); err != nil {
            writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid session"})
            return
        }

        ctx := context.WithValue(r.Context(), UserContextKey, &session.User)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

### 3.4 config.go 变更

```go
type Config struct {
    Server   ServerConfig   `yaml:"server"`
    Auth     AuthConfig     `yaml:"auth"`
    LXD      LXDConfig      `yaml:"lxd"`
    LLM      LLMConfig      `yaml:"llm"`
    Database DatabaseConfig `yaml:"database"`
}

type AuthConfig struct {
    // JWTSecret  string `yaml:"jwt_secret"`  // 删除
    AdminToken     string `yaml:"admin_token"`
    AuthServiceURL string `yaml:"auth_service_url"` // 新增: http://localhost:3100
}

type DatabaseConfig struct {
    // Path string `yaml:"path"`        // 删除 (SQLite)
    URL string `yaml:"url"`             // 新增: PostgreSQL 连接串
}
```

### 3.5 user_id 类型变更 (int64 → string)

Better Auth 使用 string ID（UUID/nanoid），所有引用 `user_id int64` 的地方需改为 `string`：

| 文件 | 改动 |
|------|------|
| `auth/middleware.go` | UserInfo.ID → string |
| `proxy/handler.go` | claims.UserID → string，GetContainerInfo 参数改 string |
| `main.go` | 所有 handler 的 claims.UserID → string |
| `store/*.go` | 所有 userID 参数改 string |
| `audit/logger.go` | Log() userID 参数改 string |

### 3.6 main.go 路由变更

```go
// 删除：
// mux.HandleFunc("POST /api/auth/login", loginHandler(...))
// ↑ 登录由 Better Auth 接管

// 新增：
mux.Handle("POST /api/admin/invite-codes",
    authMiddleware.Authenticate(authMiddleware.RequireAdmin(
        http.HandlerFunc(createInviteCodeHandler(store)))))
mux.Handle("GET /api/admin/invite-codes",
    authMiddleware.Authenticate(authMiddleware.RequireAdmin(
        http.HandlerFunc(listInviteCodesHandler(store)))))

// 重写 createUserHandler → onUserActivated（激活码使用后触发容器分配）
// 这个逻辑移到 auth-service 的 webhook 或 Go 网关轮询
```

### 3.7 go.mod 变更

```
// 删除
- modernc.org/sqlite
- golang.org/x/crypto/bcrypt  (不再需要，BA 管密码)
- github.com/golang-jwt/jwt/v5  (可选保留 admin token)

// 新增
+ github.com/jackc/pgx/v5
+ github.com/jackc/pgx/v5/pgxpool
```

---

## 4. 改造：桌面客户端

### 4.1 新增文件

```
desktop/src/lib/
├── auth-client.ts     # 新增：Better Auth Svelte 客户端
```

### 4.2 auth-client.ts

```typescript
import { createAuthClient } from "better-auth/svelte";

export const authClient = createAuthClient({
  baseURL: "http://192.168.31.162:3100",  // BA 服务地址
});
```

### 4.3 auth.svelte.ts 重写

```typescript
import { authClient } from './auth-client';

// 登录方式 1：邮箱密码（激活码注册后）
export async function loginWithPassword(email: string, password: string) {
  return authClient.signIn.email({ email, password });
}

// 登录方式 2：飞书 SSO
export async function loginWithFeishu() {
  return authClient.signIn.social({ provider: "feishu" });
}

// 登录方式 3：激活码
export async function activateWithCode(code: string, username: string, password: string) {
  const resp = await fetch("http://192.168.31.162:3100/api/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, username, password }),
  });
  if (!resp.ok) throw new Error("激活失败");
  // 激活成功后自动登录
  return loginWithPassword(`${username}@jacoworks.local`, password);
}

// Session 状态
export const session = authClient.useSession();

// 导出兼容旧接口
export function isAuthenticated() {
  return !!session.value?.data?.session;
}

export function getToken() {
  return session.value?.data?.session?.token ?? null;
}

export function getUser() {
  return session.value?.data?.user ?? null;
}

export function logout() {
  return authClient.signOut();
}
```

### 4.4 LoginPage.svelte 重写

```svelte
<script lang="ts">
  import { loginWithPassword, loginWithFeishu, activateWithCode } from '$lib/auth.svelte';

  let mode = $state<'login' | 'activate'>('login');
  let email = $state('');
  let password = $state('');
  let code = $state('');
  let username = $state('');
  let newPassword = $state('');
  let error = $state('');
  let loading = $state(false);

  async function handleLogin(e: Event) {
    e.preventDefault();
    error = ''; loading = true;
    try {
      await loginWithPassword(email, password);
    } catch (err: any) {
      error = err.message || '登录失败';
    } finally { loading = false; }
  }

  async function handleFeishu() {
    error = ''; loading = true;
    try {
      await loginWithFeishu();
    } catch (err: any) {
      error = err.message || '飞书登录失败';
    } finally { loading = false; }
  }

  async function handleActivate(e: Event) {
    e.preventDefault();
    error = ''; loading = true;
    try {
      await activateWithCode(code, username, newPassword);
    } catch (err: any) {
      error = err.message || '激活失败';
    } finally { loading = false; }
  }
</script>

<!-- 登录页面：飞书 SSO + 邮箱密码 + 激活码 三种入口 -->
```

### 4.5 sessions.ts 适配

```diff
- import { getToken } from './auth.svelte';
+ import { getToken } from './auth.svelte';
  // getToken() 现在返回 BA session token 而非自签 JWT
  // apiFetch 函数不变，只是 token 来源变了
```

### 4.6 Tauri 侧注意事项

Better Auth 使用 cookie 管理 session。Tauri WebView 默认支持 cookie，但需要：

1. `tauri.conf.json` 允许跨域请求到 BA 服务
2. `stream.rs` 的 `http_fetch` 需透传 cookie
3. 或改用 Bearer token 模式（BA 支持 `useSession` header 认证）

---

## 5. 数据库 Schema 初始化

### 5.1 连接信息

```
Host:     trolley.proxy.rlwy.net:28177
User:     postgres
Password: XNyUZUeQKPogCcGMoDgKBgkIsioOwGKd
Database: railway
Extensions: pgcrypto ✅, pg_trgm ✅
```

### 5.2 Better Auth 自动管理的表

BA 首次启动时自动创建，**不要手动建**：

- `user` — 用户主表
- `session` — 登录会话
- `account` — OAuth 绑定
- `verification` — 验证令牌

### 5.3 Go 网关业务表（手动初始化）

```sql
-- 启用扩展
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 容器映射
CREATE TABLE containers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL UNIQUE,
    container_name  TEXT NOT NULL,
    container_ip    INET,
    container_token TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'stopped'
                    CHECK (status IN ('running','stopped','frozen','creating','error')),
    cpu_limit       INT NOT NULL DEFAULT 1,
    memory_mb       INT NOT NULL DEFAULT 1024,
    disk_mb         INT NOT NULL DEFAULT 5120,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 聊天会话
CREATE TABLE chat_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,
    title           TEXT NOT NULL DEFAULT '新对话',
    type            TEXT NOT NULL DEFAULT 'chat'
                    CHECK (type IN ('chat','cowork')),
    model           TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    workspace_path  TEXT NOT NULL DEFAULT '',
    messages        JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 激活码
CREATE TABLE invite_codes (
    code            TEXT PRIMARY KEY,
    role            TEXT NOT NULL DEFAULT 'user',
    max_uses        INT NOT NULL DEFAULT 1,
    used_count      INT NOT NULL DEFAULT 0,
    created_by      TEXT,
    note            TEXT NOT NULL DEFAULT '',
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 激活码使用记录
CREATE TABLE invite_code_usages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL REFERENCES invite_codes(code) ON DELETE CASCADE,
    user_id         TEXT NOT NULL,
    used_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(code, user_id)
);

-- 审计日志
CREATE TABLE audit_logs (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         TEXT,
    action          TEXT NOT NULL,
    resource_type   TEXT,
    resource_id     TEXT,
    detail          JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 索引
CREATE INDEX idx_containers_status ON containers(status);
CREATE INDEX idx_containers_user ON containers(user_id);
CREATE INDEX idx_chat_sessions_user ON chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_updated ON chat_sessions(updated_at DESC);
CREATE INDEX idx_chat_sessions_type ON chat_sessions(user_id, type);
CREATE INDEX idx_invite_codes_expires ON invite_codes(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action, created_at DESC);
CREATE INDEX idx_chat_sessions_messages ON chat_sessions USING gin(messages);

-- 自动更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_containers_updated
    BEFORE UPDATE ON containers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_chat_sessions_updated
    BEFORE UPDATE ON chat_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## 6. 实施步骤（按顺序）

### Phase 1：基础设施 ✅ 已完成

- [x] Railway 创建 jacoworks 项目
- [x] PostgreSQL 17 部署成功
- [x] TCP Proxy 公网可达
- [x] pgcrypto + pg_trgm 扩展启用

### Phase 2：数据库 Schema

- [ ] 初始化业务表（上面的 SQL）
- [ ] 验证表结构

### Phase 3：auth-service（Better Auth 微服务）

- [ ] 创建 `auth-service/` 目录
- [ ] `npm init`，安装 `better-auth`, `express`, `pg`
- [ ] 编写 `auth.ts` (BA 配置 + PostgreSQL adapter)
- [ ] 编写 `index.ts` (Express server)
- [ ] 编写 `invite.ts` (激活码逻辑)
- [ ] 本地测试：BA 自动建表 + 注册/登录/get-session
- [ ] 部署到宿主机 (systemd service)

### Phase 4：Go 网关适配

- [ ] 更换数据库驱动：`modernc.org/sqlite` → `pgx/v5`
- [ ] 重写 `internal/store/` (pgx 连接池 + CRUD)
- [ ] 重写 `internal/auth/middleware.go` (调 BA 验证)
- [ ] 重写 `config.go` (database.url + auth.auth_service_url)
- [ ] 删除 `loginHandler`，新增 `inviteCodeHandler`
- [ ] 适配 user_id `int64` → `string`
- [ ] `main.go` 更新路由表
- [ ] 本地测试全部 API

### Phase 5：桌面端适配

- [ ] 安装 `better-auth` npm 包
- [ ] 新建 `auth-client.ts` (BA Svelte 客户端)
- [ ] 重写 `auth.svelte.ts` (三种登录方式)
- [ ] 重写 `LoginPage.svelte` (飞书 SSO + 密码 + 激活码)
- [ ] 适配 `sessions.ts` (token 来源变更)
- [ ] Tauri `stream.rs` / `http_fetch` 适配 cookie 或 bearer
- [ ] 端到端联调

### Phase 6：飞书 SSO（可延后）

- [ ] 飞书开放平台创建应用
- [ ] 配置 OAuth 回调 URL
- [ ] auth-service 配置飞书 client_id/secret
- [ ] 桌面端飞书登录按钮
- [ ] 联调测试

---

## 7. API 变更汇总

### 删除的 API

| 方法 | 路径 | 替代 |
|------|------|------|
| POST | `/api/auth/login` | Better Auth `/api/auth/sign-in/email` |

### 新增的 API

| 方法 | 路径 | 说明 | 归属 |
|------|------|------|------|
| ALL | `/api/auth/*` | BA 认证 (登录/注册/OAuth/session) | auth-service |
| POST | `/api/activate` | 激活码验证 + 创建用户 | auth-service |
| POST | `/api/admin/invite-codes` | 生成激活码 | Go 网关 |
| GET | `/api/admin/invite-codes` | 列出激活码 | Go 网关 |

### 不变的 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/users/me` | 当前用户信息（鉴权方式变更） |
| GET/POST/PUT/DELETE | `/api/sessions/*` | 聊天会话 CRUD |
| POST | `/v1/chat/completions` | Chat 透传 |
| POST/GET | `/api/cowork/*` | Cowork 文件操作 |
| GET/POST | `/api/admin/containers/*` | 容器管理 |
| GET | `/health` | 健康检查 |

---

## 8. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| BA 服务宕机 → 所有请求鉴权失败 | 网关缓存最近有效 session (5min TTL) |
| user_id 类型变更影响范围大 | 分步重构，先适配 store 层，再改 handler |
| Tauri cookie 跨域问题 | 优先使用 Bearer token 模式，cookie 作备选 |
| 现有用户数据迁移 | 当前用户量极小，可手动重建 |
| PostgreSQL 网络延迟 (Railway) | 宿主机↔Railway 延迟 ~50ms，可接受；后续可迁移到本地 |

---

## 9. 环境变量汇总

### auth-service/.env

```env
DATABASE_URL=postgresql://postgres:XNyUZUeQKPogCcGMoDgKBgkIsioOwGKd@trolley.proxy.rlwy.net:28177/railway
BETTER_AUTH_SECRET=<生成32+字符随机串>
BETTER_AUTH_URL=http://192.168.31.162:3100
FEISHU_CLIENT_ID=<待配置>
FEISHU_CLIENT_SECRET=<待配置>
```

### gateway.yaml

```yaml
server:
  port: 8090
  host: "0.0.0.0"
auth:
  admin_token: "<admin-token>"
  auth_service_url: "http://localhost:3100"    # 新增
database:
  url: "postgresql://postgres:XNyUZUeQKPogCcGMoDgKBgkIsioOwGKd@trolley.proxy.rlwy.net:28177/railway"  # 新增
lxd:
  ssh_target: "local"
  template: "tpl-openclaw"
  network: "jaconet"
  openclaw_port: 18789
llm:
  proxy_url: "http://67.230.171.248:8317"
  proxy_key: "<key>"
```

### desktop/.env

```env
PUBLIC_AUTH_URL=http://192.168.31.162:3100
PUBLIC_GATEWAY_URL=http://192.168.31.162:8090
```
