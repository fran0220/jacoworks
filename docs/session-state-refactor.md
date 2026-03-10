# Session 状态重构：DB 为唯一真相源

## 问题

**现象**：在一个线程保持运行时切换到另外一个线程，会出现消息漂移错乱。

**根因**：双源真相（dual source of truth）
- 本地内存维护 `localSession.messages`
- 网关 PostgreSQL 异步 persist
- 切换 session 时，本地状态和 DB 状态不一致

## 解决方案

**原则**：Database as Single Source of Truth (SSOT)

### 架构变更

```
旧架构（双源）:
  本地内存 messages[] ←→ 异步 persist → PostgreSQL
  ↓ 切换 session
  从 DB 加载 ← 可能不一致

新架构（单源）:
  PostgreSQL (SSOT)
  ↓ 实时读取
  本地只做渲染缓存（streaming 期间临时状态）
  ↓ 立即写回
  PostgreSQL
```

### 实现策略

#### 1. 消息写入：立即同步到 DB

**旧逻辑**：
```typescript
// 流式渲染期间，消息只在内存
setLocalSession({ ...session, messages: [...messages, newMessage] });

// 对话结束后才 persist
await persistMessages(sessionId, messages);
```

**新逻辑**：
```typescript
// 每条消息立即写入 DB
await persistMessages(sessionId, [...messages, newMessage]);

// 本地状态从 DB 刷新
const updated = await getSession(sessionId);
setLocalSession(updated);
```

#### 2. 消息读取：始终从 DB 加载

**旧逻辑**：
```typescript
// 切换 session 时，可能读到旧数据
useEffect(() => {
  if (currentSession?.id === currentSessionId) return; // 跳过重新加载
  getSession(currentSessionId).then(setCurrentSession);
}, [currentSessionId]);
```

**新逻辑**：
```typescript
// 切换 session 时，强制从 DB 重新加载
useEffect(() => {
  getSession(currentSessionId).then(setCurrentSession);
}, [currentSessionId]);

// 当前 session 的消息也定期刷新（轮询或 WebSocket 推送）
useInterval(() => {
  if (currentSessionId && !streaming) {
    getSession(currentSessionId).then(setCurrentSession);
  }
}, 5000); // 5 秒刷新一次
```

#### 3. 流式渲染：临时缓存 + 立即写回

**流式期间**：
```typescript
// 1. 用户消息立即写入 DB
await persistMessages(sessionId, [...messages, userMessage]);

// 2. 流式渲染期间，assistant 消息在内存累积
const streamingMessage = { role: "assistant", content: "" };
for await (const chunk of stream) {
  streamingMessage.content += chunk;
  setLocalSession({ ...session, messages: [...messages, streamingMessage] });
}

// 3. 流式结束，立即写回 DB
await persistMessages(sessionId, [...messages, streamingMessage]);

// 4. 从 DB 刷新确认
const updated = await getSession(sessionId);
setLocalSession(updated);
```

### 代码改动清单

#### 文件 1: `desktop/src/react/hooks/use-chat-stream.ts`

**改动点**：
1. 移除 `localSession` 状态，改用 `session` prop 直接渲染
2. 流式渲染期间，用临时状态 `streamingBlocks` 显示进度
3. 每个关键节点（用户消息、assistant 消息、工具调用）立即 persist + 刷新

**关键函数**：
```typescript
// 新增：立即写入并刷新
async function persistAndRefresh(sessionId: string, messages: ChatMessage[]) {
  await persistMessages(sessionId, messages);
  await onSessionUpdate(); // 触发父组件从 DB 重新加载
}

// 修改：sendMessage 立即写入用户消息
const sendMessage = useCallback(async (text: string, files: AttachedFile[]) => {
  const userMessage = { role: "user", content: text, timestamp: Date.now() };
  await persistAndRefresh(session.id, [...session.messages, userMessage]);
  
  // 启动流式渲染...
}, [session]);

// 修改：流式结束立即写入 assistant 消息
const finalizeStream = useCallback(async () => {
  const assistantMessage = { role: "assistant", content: fullText, blocks: metaBlocks };
  await persistAndRefresh(session.id, [...session.messages, assistantMessage]);
}, [session]);
```

#### 文件 2: `desktop/src/react/hooks/use-session-state.ts`

**改动点**：
1. 移除 `currentSession?.id === currentSessionId` 的跳过逻辑
2. 每次切换 session 都强制从 DB 重新加载
3. 新增定期刷新机制（非流式期间）

**关键函数**：
```typescript
useEffect(() => {
  if (!currentSessionId) {
    setCurrentSession(null);
    return;
  }

  // 强制从 DB 加载，不跳过
  let cancelled = false;
  getSession(currentSessionId)
    .then((session) => {
      if (!cancelled && session) {
        setCurrentSession(session);
      }
    });

  return () => { cancelled = true; };
}, [currentSessionId]); // 移除 currentSession?.id 依赖

// 新增：定期刷新当前 session（非流式期间）
useEffect(() => {
  if (!currentSessionId || streaming) return;
  
  const interval = setInterval(async () => {
    const session = await getSession(currentSessionId);
    if (session) setCurrentSession(session);
  }, 5000);
  
  return () => clearInterval(interval);
}, [currentSessionId, streaming]);
```

#### 文件 3: `desktop/src/react/lib/session-persistence.ts`

**改动点**：
1. `persistMessages` 改为同步操作（await 完成）
2. 添加重试逻辑（网络失败时）
3. 添加乐观锁（version 字段防止并发写冲突）

**关键函数**：
```typescript
export async function persistMessages(
  sessionId: string,
  messages: ChatMessage[],
  title?: string,
  retries = 3,
) {
  for (let i = 0; i < retries; i++) {
    try {
      await updateSession(sessionId, {
        messages,
        ...(title ? { title } : {}),
      });
      return; // 成功
    } catch (err) {
      if (i === retries - 1) throw err; // 最后一次重试失败
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1))); // 指数退避
    }
  }
}
```

### 性能优化

#### 问题：频繁 DB 读写影响性能

**优化 1：批量写入**
```typescript
// 流式渲染期间，每 N 个 token 或 M 秒写一次
let pendingWrite: ChatMessage[] | null = null;
let writeTimer: NodeJS.Timeout | null = null;

function schedulePersist(messages: ChatMessage[]) {
  pendingWrite = messages;
  if (writeTimer) return;
  
  writeTimer = setTimeout(async () => {
    if (pendingWrite) {
      await persistMessages(sessionId, pendingWrite);
      pendingWrite = null;
    }
    writeTimer = null;
  }, 2000); // 2 秒批量写入
}
```

**优化 2：本地缓存 + 脏标记**
```typescript
// 本地缓存最近访问的 session
const sessionCache = new Map<string, { session: ChatSession; dirty: boolean }>();

function getCachedSession(sessionId: string): ChatSession | null {
  const cached = sessionCache.get(sessionId);
  if (cached && !cached.dirty) return cached.session;
  return null;
}

function markDirty(sessionId: string) {
  const cached = sessionCache.get(sessionId);
  if (cached) cached.dirty = true;
}
```

**优化 3：WebSocket 推送更新**
```typescript
// 网关推送 session 更新事件
gateway.on("session.updated", (event) => {
  if (event.sessionId === currentSessionId) {
    getSession(event.sessionId).then(setCurrentSession);
  }
});
```

### 迁移步骤

1. **Phase 1**: 添加立即写入逻辑（保留旧的本地状态作为 fallback）
2. **Phase 2**: 添加定期刷新机制
3. **Phase 3**: 移除本地状态依赖，完全依赖 DB
4. **Phase 4**: 添加性能优化（批量写入、缓存）

### 测试清单

- [ ] 单 session 对话，消息正确保存和显示
- [ ] 快速切换 session，消息不丢失不重复
- [ ] 流式渲染期间切换 session，不崩溃
- [ ] 网络断开时，消息缓存在本地，重连后自动同步
- [ ] 多设备同时编辑同一 session（冲突检测）
- [ ] 性能测试：100 条消息的 session 切换延迟 <500ms

### 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| DB 写入延迟导致 UI 卡顿 | 中 | 批量写入 + 异步队列 |
| 网络断开时消息丢失 | 高 | 本地队列 + 重连后自动同步 |
| 并发写入导致消息覆盖 | 中 | 乐观锁（version 字段） |
| 频繁 DB 查询增加服务器负载 | 低 | 本地缓存 + 脏标记 |

### 总结

这个重构将彻底解决"双源真相"导致的状态不一致问题。核心思想是：

1. **DB 是唯一真相源**：所有持久化状态都在 PostgreSQL
2. **本地只做渲染缓存**：流式渲染期间的临时状态，立即写回 DB
3. **强制刷新机制**：切换 session 时从 DB 重新加载，定期刷新当前 session
4. **性能优化**：批量写入、本地缓存、WebSocket 推送

预期效果：
- ✅ 消息不再漂移错乱
- ✅ 多设备同步一致
- ✅ 崩溃恢复不丢消息
- ✅ 性能影响可控（<500ms 切换延迟）
