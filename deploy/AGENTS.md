# Deploy — 部署配置与 SQL Schema

> SQL schema 文件、测试数据、部署脚本和基础设施配置。

## SQL Schema 文件

| 文件 | 说明 |
|------|------|
| `sql/001_init_business_tables.sql` | 全量 schema (users, auth_sessions, chat_sessions, containers, invite_codes, audit_logs) |
| `sql/002_website_tables.sql` | 官网表 (releases, release_assets, feedback) |
| `sql/003_system_settings.sql` | system_settings 表 (LLM 密钥管理) |
| `sql/004_memory_and_skills.sql` | user_memory + skill_files 表 (记忆/技能同步) |
| `sql/005_games.sql` | games 表 (游戏画廊) |
| `sql/006_add_host_port.sql` | containers 表增加 host_port 字段 |
| `sql/007_frozen_to_paused.sql` | containers status 值迁移 |
| `sql/008_cron_jobs.sql` | cron_jobs 表 (云端定时任务调度) |
| `sql/002_seed_test_data.sql` | 测试数据 (admin 用户 + 激活码) |

## 测试账号

| 用途 | 用户名 | 密码 | 角色 |
|------|--------|------|------|
| 管理员 | `admin@jacoworks.local` | `admin123` | admin |
| E2E 测试 | `e2e-tester` | `e2e-test-2026` | user |

激活码: `JACO-TEST-2026` (admin) / `JACO-USER-2026` (user) / `02fd4b5c6a128c762a99966de11ba110` (E2E 自动注册, max_uses=100)

## 数据库

PostgreSQL (jingao 本地 `127.0.0.1:5432/jacoworks`)。

关键表: `users` `auth_sessions` `chat_sessions` `containers` `invite_codes` `audit_logs` `system_settings` `user_memory` `skill_files` `games` `releases` `release_assets` `feedback` `cron_jobs`

`user_id` 为 TEXT (gen_random_uuid()::text)。`updated_at` 触发器自动更新。

## 基础设施

| 服务 | 位置 | 说明 |
|------|------|------|
| Rust 官网 | jingao 82.156.239.212 | :9527, OpenResty 反代 jaco.jingao.club |
| Go 网关 | jingao 82.156.239.212 | :8847, OpenResty 反代 jacoapi.jingao.club |
| PostgreSQL | jingao 本地 | 127.0.0.1:5432/jacoworks |
| WireGuard | jingao ↔ jpdata ↔ oracle | wg1: 10.0.1.1 ↔ 10.0.1.254 ↔ 10.0.1.3 |
| Docker 容器 | oracle 161.33.28.249 | agent-net 网络, jacoworks/vm-agent:latest (ARM) |
| LLM 中转站 | 67.230.182.59 | :8317 |

## 部署

- **gateway / website**: `make deploy` → SSH jingao → git pull → 本地编译 → 重启
- **vm-agent (oracle)**: `make deploy-agent` → 本地 cross-build ARM64 镜像 → docker save → scp via jingao → docker load → 重启容器
- **desktop macOS**: 本地构建 + 签名 + 手动公证 → 上传 jingao + GitHub Release
- **desktop Windows**: 本地 VM (win-build) 构建 → 上传 jingao + GitHub Release
