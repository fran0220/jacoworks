# JAcoworks 双源真相问题分析

> 分析日期: 2026-03-10
> 
> 本文档系统分析 JAcoworks 架构中存在的"双源真相"（Dual Source of Truth）问题，这些问题可能导致状态不一致、数据漂移或冲突。

## 已修复问题

### ✅ 1. Session 消息状态 (已修复 2026-03-10)

**问题**: 本地内存 `localSession.messages` + 网关 PostgreSQL 异步 persist

**修复**: 
- 移除跳过逻辑，每次切换强制从 DB 加载
- persist 后立即刷新
- 定期刷新机制（5 秒）
- 重试逻辑（指数退避）

---

## 🔴 高风险问题

### 2. 容器状态同步 (Critical)

**双源**:
- **网关 DB**: `containers` 表的 `status` 字段 (`creating` / `running` / `paused` / `stopped` / `exited`)
- **Docker 实际状态**: 容器真实运行状态

**问题场景**:
1. **手动操作容器**: 用户直接 `docker stop/start` 容器，DB 状态不更新
2. **容器崩溃**: 容器 OOM 或异常退出，DB 仍显示 `running`
3. **网络分区**: 网关与 Docker daemon 失联，状态无法同步
4. **Freezer 操作失败**: pause/unpause 失败但 DB 已更新状态

**影响**:
- 用户看到"运行中"但实际容器已停止
- WS 代理尝试连接已停止的容器，连接失败
- 资源回收策略基于错误状态，导致泄漏

**当前缓解措施**:
- `EnsureRunning()` 在 WS 连接前检查 Docker 实际状态
- Freezer 定期扫描容器列表，更新 DB 状态
- 健康检查失败时重试

**根本解决方案**:
```go
// 方案 A: Docker 事件监听 (推荐)
// 监听 Docker events API，实时同步状态变更
func (c *Client) WatchContainerEvents(ctx context.Context) {
    events, errs := c.cli.Events(ctx, types.EventsOptions{
        Filters: filters.NewArgs(
            filters.Arg("type", "container"),
            filters.Arg("event", "start"),
            filters.Arg("event", "stop"),
            filters.Arg("event", "die"),
            filters.Arg("event", "pause"),
            filters.Arg("event", "unpause"),
        ),
    })
    
    for {
        select {
        case event := <-events:
            // 更新 DB 状态
            c.store.UpdateContainerStatusByName(ctx, event.Actor.Attributes["name"], mapStatus(event.Action))
        case err := <-errs:
            log.Error().Err(err).Msg("docker events error")
        }
    }
}

// 方案 B: 定期全量同步 (fallback)
// 每 30 秒全量对比 Docker 状态和 DB 状态
func (c *Client) SyncContainerStates(ctx context.Context) {
    containers, _ := c.cli.ContainerList(ctx, types.ContainerListOptions{All: true})
    for _, ct := range containers {
        dbStatus := c.store.GetContainerStatus(ctx, ct.Names[0])
        dockerStatus := mapDockerState(ct.State)
        if dbStatus != dockerStatus {
            c.store.UpdateContainerStatusByName(ctx, ct.Names[0], dockerStatus)
            log.Warn().Str("container", ct.Names[0]).
                Str("db_status", dbStatus).
                Str("docker_status", dockerStatus).
                Msg("container status drift detected and fixed")
        }
    }
}
```

**优先级**: 🔴 Critical (影响核心功能)

---

### 3. OpenClaw 容器配置同步 (High)

**双源**:
- **网关 DB**: `containers.config` JSONB + `llm_providers` + `llm_models` 表
- **容器内配置**: `/data/openclaw.json` 文件

**问题场景**:
1. **管理员更新 LLM 配置**: DB 更新但容器内配置未同步
2. **容器重启**: 从旧配置文件启动，覆盖 DB 最新配置
3. **手动修改容器配置**: 用户 SSH 进容器修改 `openclaw.json`，DB 不知道
4. **配置热同步失败**: `SyncConfigToContainer()` 失败但 DB 已更新 hash

**影响**:
- 用户看到新模型但容器实际不可用
- 配置漂移导致行为不一致
- 热重载失效，需要重启容器

**当前缓解措施**:
- `desired_config_hash` vs `applied_config_hash` 追踪同步状态
- 管理后台提供"同步配置"按钮手动触发
- 容器启动时从 DB 生成配置

**根本解决方案**:
```go
// 方案 A: 配置版本号 + 强制同步
type ContainerConfig struct {
    Version    int64  `json:"version"`     // 递增版本号
    UpdatedAt  string `json:"updated_at"`  // 时间戳
    // ... 其他配置
}

// 容器启动时检查版本号，不匹配则拒绝启动
func (c *OpenClawClient) ValidateConfigVersion(ctx context.Context) error {
    containerVersion := c.getConfigVersion()
    dbVersion := c.store.GetConfigVersion(ctx, c.containerName)
    if containerVersion != dbVersion {
        return fmt.Errorf("config version mismatch: container=%d, db=%d", containerVersion, dbVersion)
    }
    return nil
}

// 方案 B: 配置只读 + 挂载卷
// 容器内配置文件只读，通过 Docker volume 挂载
// 更新配置 = 更新宿主机文件 + 发送 SIGHUP 信号给容器
docker run -v /srv/openclaw/config:/data/config:ro ...

// 方案 C: 配置 API 化
// 容器不读本地文件，启动时从网关 API 拉取配置
// 配置更新通过 WebSocket 推送到容器
```

**优先级**: 🟠 High (影响用户体验)

---

### 4. 记忆同步冲突 (High)

**双源**:
- **桌面端本地**: `~/Library/Application Support/JAcoworks/memory/`
- **网关 DB**: `user_memory` 表

**问题场景**:
1. **多设备并发编辑**: 设备 A 和设备 B 同时修改 `MEMORY.md`
2. **同步失败**: 网络断开，本地修改未上传，切换设备后丢失
3. **冲突解决策略**: 当前是 last-write-wins，可能覆盖重要内容
4. **部分同步**: 上传成功但下载失败，导致单向不一致

**影响**:
- 用户在设备 A 的记忆在设备 B 看不到
- 重要记忆被覆盖丢失
- 多设备协作时数据混乱

**当前缓解措施**:
- Checksum 比对，只同步变更文件
- 30 秒防抖，减少冲突概率
- 默认关闭同步（`memorySyncEnabled: false`）

**根本解决方案**:
```typescript
// 方案 A: 三向合并 (3-way merge)
interface MemoryFile {
    path: string;
    content: string;
    checksum: string;
    version: number;      // 版本号
    last_modified: string; // 时间戳
}

async function syncMemoryWithMerge() {
    const local = await listLocalMemory();
    const remote = await fetchRemoteMemory();
    const base = await getLastSyncSnapshot(); // 上次同步的快照
    
    for (const file of allFiles) {
        const localVersion = local[file.path];
        const remoteVersion = remote[file.path];
        const baseVersion = base[file.path];
        
        if (localVersion === baseVersion && remoteVersion !== baseVersion) {
            // 只有远程修改，拉取
            await pullFile(file.path);
        } else if (remoteVersion === baseVersion && localVersion !== baseVersion) {
            // 只有本地修改，推送
            await pushFile(file.path);
        } else if (localVersion !== baseVersion && remoteVersion !== baseVersion) {
            // 双方都修改，冲突！
            await resolveConflict(file.path, localVersion, remoteVersion, baseVersion);
        }
    }
    
    await saveLastSyncSnapshot(local);
}

// 方案 B: CRDT (Conflict-free Replicated Data Type)
// 使用 Yjs 或 Automerge 实现自动合并
import * as Y from 'yjs';

const ydoc = new Y.Doc();
const ytext = ydoc.getText('memory');

// 本地编辑
ytext.insert(0, 'new content');

// 同步到远程
const update = Y.encodeStateAsUpdate(ydoc);
await pushUpdate(update);

// 从远程拉取
const remoteUpdate = await pullUpdate();
Y.applyUpdate(ydoc, remoteUpdate); // 自动合并，无冲突

// 方案 C: 操作日志 (Operational Transformation)
// 记录每次编辑操作，而不是最终状态
interface MemoryOperation {
    id: string;
    timestamp: number;
    type: 'insert' | 'delete' | 'replace';
    path: string;
    position: number;
    content: string;
}

// 同步时重放操作日志，自动解决冲突
```

**优先级**: 🟠 High (数据丢失风险)

---

## 🟡 中风险问题

### 5. 用户技能同步 (Medium)

**双源**:
- **桌面端本地**: `~/Library/Application Support/JAcoworks/skills/`
- **网关 DB**: `skill_files` 表 (owner='user')

**问题场景**:
1. **上传失败**: 本地创建技能但 push 失败，云端容器看不到
2. **多设备不一致**: 设备 A 创建技能，设备 B 不知道（没有 pull 机制）
3. **删除不同步**: 本地删除技能但网关仍保留

**影响**:
- 云端容器缺少用户技能
- 多设备技能列表不一致

**当前缓解措施**:
- Checksum 比对，只上传变更
- 启动时自动 push

**根本解决方案**:
```typescript
// 方案 A: 双向同步 (类似 memory-sync)
async function syncUserSkills() {
    const local = await listLocalSkills();
    const remote = await fetchRemoteSkills();
    
    // Pull: 远程有但本地没有
    for (const skill of remote) {
        if (!local.includes(skill.id)) {
            await downloadSkill(skill.id);
        }
    }
    
    // Push: 本地有但远程没有
    for (const skill of local) {
        if (!remote.includes(skill.id)) {
            await uploadSkill(skill.id);
        }
    }
    
    // Conflict: 双方都有但内容不同
    for (const skill of local) {
        const remoteSkill = remote.find(s => s.id === skill.id);
        if (remoteSkill && skill.checksum !== remoteSkill.checksum) {
            // 比较时间戳，保留最新的
            if (skill.modified > remoteSkill.modified) {
                await uploadSkill(skill.id);
            } else {
                await downloadSkill(skill.id);
            }
        }
    }
}

// 方案 B: 网关为唯一真相源
// 桌面端只做缓存，所有修改都通过 API
// 类似 VS Code 的 Settings Sync
```

**优先级**: 🟡 Medium (影响功能完整性)

---

### 6. 定时任务状态 (Medium)

**双源**:
- **Sidecar 模式**: 网关 DB `cron_jobs` 表
- **Server 模式**: 容器内 `cron-jobs.json` 文件

**问题场景**:
1. **模式切换**: 用户从 sidecar 切换到 server，任务列表不同步
2. **容器重建**: 容器删除重建，`cron-jobs.json` 丢失
3. **手动修改**: 用户 SSH 进容器修改 `cron-jobs.json`，DB 不知道

**影响**:
- 任务列表不一致
- 任务丢失或重复执行

**当前缓解措施**:
- Sidecar 模式完全代理到网关 API
- Server 模式独立管理本地文件

**根本解决方案**:
```go
// 方案 A: 统一存储到 DB
// Server 模式也使用 DB，不用本地文件
// 容器启动时从 DB 加载任务

// 方案 B: 容器启动时同步
// 从 DB 拉取任务列表，写入本地文件
func (c *CronService) SyncFromDB(ctx context.Context) error {
    jobs, err := c.gateway.ListCronJobs(ctx)
    if err != nil {
        return err
    }
    return c.writeJobsFile(jobs)
}
```

**优先级**: 🟡 Medium (影响自动化功能)

---

### 7. 会话列表缓存 (Medium)

**双源**:
- **桌面端状态**: `sessions` 数组（从 DB 加载）
- **网关 DB**: `chat_sessions` 表

**问题场景**:
1. **新建会话**: 创建后立即切换，列表未刷新
2. **删除会话**: 删除后列表仍显示（已有 `refreshSessions()` 缓解）
3. **多设备同步**: 设备 A 创建会话，设备 B 看不到

**影响**:
- 会话列表显示过时数据
- 多设备体验不一致

**当前缓解措施**:
- 创建/删除后调用 `refreshSessions()`
- 登录时自动刷新

**根本解决方案**:
```typescript
// 方案 A: 定期刷新
useEffect(() => {
    const interval = setInterval(() => {
        refreshSessions();
    }, 30_000); // 30 秒
    return () => clearInterval(interval);
}, []);

// 方案 B: WebSocket 推送
gateway.on('session.created', (event) => {
    setSessions(prev => [event.session, ...prev]);
});

gateway.on('session.deleted', (event) => {
    setSessions(prev => prev.filter(s => s.id !== event.sessionId));
});
```

**优先级**: 🟡 Medium (影响用户体验)

---

## 🟢 低风险问题

### 8. 用户配置/设置 (Low)

**双源**:
- **桌面端 localStorage**: `AppSettings` (memoryEnabled, defaultWorkspace, etc.)
- **网关 DB**: 可能有用户偏好设置（目前没有）

**问题场景**:
1. **多设备不同步**: 设备 A 的设置在设备 B 不生效
2. **重装应用**: localStorage 清空，设置丢失

**影响**:
- 多设备体验不一致
- 需要重新配置

**当前缓解措施**:
- 设置只存本地，不同步

**根本解决方案**:
```typescript
// 方案 A: 同步到网关 (类似 VS Code Settings Sync)
async function syncSettings() {
    const local = getSettings();
    const remote = await fetchRemoteSettings();
    
    // 合并策略：本地优先，但远程有新字段则拉取
    const merged = { ...remote, ...local };
    updateSettings(merged);
    await pushSettings(merged);
}

// 方案 B: 保持本地优先
// 设置是个人偏好，不需要同步
// 只在首次登录时从网关拉取默认值
```

**优先级**: 🟢 Low (不影响核心功能)

---

### 9. 最近使用的文件夹 (Low)

**双源**:
- **桌面端 localStorage**: `recentFolders` 数组
- **无远程存储**

**问题场景**:
1. **多设备不同步**: 设备 A 的最近文件夹在设备 B 看不到
2. **路径不存在**: 设备 A 的路径在设备 B 不存在

**影响**:
- 多设备体验不一致
- 无效路径显示

**当前缓解措施**:
- 只存本地，不同步

**根本解决方案**:
```typescript
// 方案 A: 不同步（推荐）
// 最近文件夹是设备特定的，不应该同步

// 方案 B: 智能过滤
// 同步时过滤掉不存在的路径
async function syncRecentFolders() {
    const local = getRecentFolders();
    const remote = await fetchRemoteRecentFolders();
    
    // 合并并过滤不存在的路径
    const merged = [...new Set([...local, ...remote])];
    const valid = merged.filter(path => existsSync(path));
    
    updateRecentFolders(valid);
}
```

**优先级**: 🟢 Low (不影响核心功能)

---

## 架构建议

### 通用原则

1. **明确真相源**: 每个数据必须有唯一的真相源（DB 或本地）
2. **缓存标记**: 本地缓存必须标记为"缓存"，定期失效
3. **冲突检测**: 双向同步必须有冲突检测和解决策略
4. **版本控制**: 关键数据使用版本号或时间戳追踪变更
5. **事件驱动**: 使用 WebSocket 推送实时更新，减少轮询

### 优先级排序

| 问题 | 优先级 | 影响范围 | 建议方案 |
|------|--------|----------|----------|
| 容器状态同步 | 🔴 Critical | 核心功能 | Docker 事件监听 + 定期全量同步 |
| OpenClaw 配置同步 | 🟠 High | 用户体验 | 配置版本号 + 强制同步 |
| 记忆同步冲突 | 🟠 High | 数据安全 | 三向合并 或 CRDT |
| 用户技能同步 | 🟡 Medium | 功能完整性 | 双向同步 + 冲突解决 |
| 定时任务状态 | 🟡 Medium | 自动化 | 统一存储到 DB |
| 会话列表缓存 | 🟡 Medium | 用户体验 | 定期刷新 + WebSocket 推送 |
| 用户配置 | 🟢 Low | 便利性 | 保持本地优先 |
| 最近文件夹 | 🟢 Low | 便利性 | 不同步 |

### 实施路线图

**Phase 1: 修复 Critical 问题** (1-2 周)
- [ ] 实现 Docker 事件监听
- [ ] 添加容器状态定期同步
- [ ] 测试容器状态一致性

**Phase 2: 修复 High 问题** (2-3 周)
- [ ] OpenClaw 配置版本号机制
- [ ] 记忆同步三向合并
- [ ] 测试多设备同步场景

**Phase 3: 修复 Medium 问题** (1-2 周)
- [ ] 用户技能双向同步
- [ ] 定时任务统一存储
- [ ] 会话列表 WebSocket 推送

**Phase 4: 优化 Low 问题** (可选)
- [ ] 用户配置同步（如果需要）
- [ ] 最近文件夹智能过滤

---

## 测试清单

### 容器状态同步测试
- [ ] 手动 `docker stop` 容器，检查 DB 状态是否更新
- [ ] 容器 OOM 崩溃，检查 DB 状态是否更新
- [ ] 网关重启，检查状态是否从 Docker 同步
- [ ] Freezer pause/unpause，检查状态一致性

### 配置同步测试
- [ ] 管理员更新 LLM 配置，检查容器内配置是否同步
- [ ] 容器重启，检查配置是否从 DB 加载
- [ ] 手动修改容器配置，检查是否被覆盖
- [ ] 配置热同步失败，检查 hash 状态

### 记忆同步测试
- [ ] 多设备并发编辑同一文件，检查冲突解决
- [ ] 网络断开时编辑，重连后检查同步
- [ ] 删除文件，检查双向同步
- [ ] 大文件同步，检查性能

### 技能同步测试
- [ ] 本地创建技能，检查云端是否可用
- [ ] 多设备技能列表一致性
- [ ] 删除技能，检查双向同步

---

## 总结

JAcoworks 目前存在 **8 个双源真相问题**，其中：
- 🔴 **1 个 Critical**: 容器状态同步
- 🟠 **2 个 High**: OpenClaw 配置同步、记忆同步冲突
- 🟡 **3 个 Medium**: 用户技能、定时任务、会话列表
- 🟢 **2 个 Low**: 用户配置、最近文件夹

**核心建议**:
1. 优先修复容器状态同步（影响核心功能）
2. 为关键数据添加版本控制和冲突检测
3. 使用 WebSocket 推送减少轮询和延迟
4. 明确每个数据的真相源，避免双向同步

**长期目标**:
- 建立统一的状态同步框架
- 所有关键数据使用 CRDT 或 OT 实现无冲突同步
- 完善的监控和告警机制，及时发现状态漂移
