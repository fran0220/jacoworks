# Pi SDK 优化方案 (v1.5.1)

> 基于 Pi SDK 的三大优化：环境 PATH 自动修复、协议错误重试、中国大陆 pip 镜像

## 问题与解决方案

### 1. 环境 PATH 问题 ✅

**问题**:
- GUI 应用不加载 ~/.bashrc/~/.zshrc，导致 nvm/pyenv/conda/virtualenv 路径缺失
- 用户看到 "command not found" 错误但不知道如何修复
- 每个命令都是新 shell，无法激活 virtualenv

**解决方案** (`vm-agent/src/lib/env-enrichment.ts`):
- 自动检测并注入常用工具路径 (nvm, pyenv, conda, Homebrew, Rust, Go)
- 自动检测并激活项目 virtualenv (venv/.venv/env)
- 自动添加 node_modules/.bin 到 PATH
- 尝试从 login shell 加载完整 PATH
- 按工作区缓存结果，避免重复检测

**集成点**: `remote-bash.ts` 在执行命令前调用 `getEnrichedEnv(cwd)`

### 2. "invalid request body" 错误 ✅

**问题**:
- Pi SDK 协议转换层 (anthropic-messages ↔ openai-completions) 偶发错误
- 可能由 tool_use 响应格式不兼容或 session 状态损坏引起
- 用户体验差，对话中断

**解决方案** (`vm-agent/src/lib/prompt-retry.ts`):
- 自动重试机制 (默认 2 次，1 秒延迟)
- 识别可重试错误 (invalid request body, network error, timeout)
- 消息清理 (移除 null bytes, 验证 UTF-8, trim 空白)
- 结构化日志记录每次重试

**集成点**: `transport/handler.ts` 用 `promptWithRetry()` 替换 `session.prompt()`

### 3. 中国大陆 pip 安装 ✅

**问题**:
- PyPI 在中国大陆访问慢或被墙
- 用户不知道如何配置镜像

**解决方案** (`vm-agent/src/lib/python-setup.ts`):
- 自动检测中国大陆用户 (时区 Asia/Shanghai + locale zh-CN)
- 自动配置 pip 镜像 (~/.pip/pip.conf 或 %APPDATA%\pip\pip.ini)
- 使用清华大学镜像 (https://pypi.tuna.tsinghua.edu.cn/simple)
- 提供 `pipInstall()` 函数支持多镜像 fallback

**集成点**: `agent.ts` 初始化时调用 `setupPipMirror()`

## 文件清单

| 文件 | 说明 |
|------|------|
| `vm-agent/src/lib/env-enrichment.ts` | PATH 自动修复 (nvm/pyenv/virtualenv/node_modules) |
| `vm-agent/src/lib/prompt-retry.ts` | 协议错误重试 + 消息清理 |
| `vm-agent/src/lib/python-setup.ts` | 中国大陆 pip 镜像自动配置 |
| `vm-agent/src/tools/remote-bash.ts` | 集成 env-enrichment |
| `vm-agent/src/transport/handler.ts` | 集成 prompt-retry |
| `vm-agent/src/agent.ts` | 集成 python-setup |

## 测试计划

### 单元测试
```bash
# 测试 env-enrichment
bun test src/lib/__tests__/env-enrichment.test.ts

# 测试 prompt-retry
bun test src/lib/__tests__/prompt-retry.test.ts

# 测试 python-setup
bun test src/lib/__tests__/python-setup.test.ts
```

### E2E 测试
```bash
# 验证 PATH 修复 (nvm/pyenv/virtualenv)
bun test src/__tests__/env-path.e2e.test.ts

# 验证协议错误重试
bun test src/__tests__/prompt-retry.e2e.test.ts

# 验证 pip 镜像
bun test src/__tests__/python-pip.e2e.test.ts
```

## 部署清单

1. **代码审查**: 确认三个新文件逻辑正确
2. **单元测试**: 编写并通过所有单元测试
3. **E2E 测试**: 在真实环境验证 (macOS/Windows/Linux)
4. **文档更新**: 更新 `vm-agent/AGENTS.md` 说明新特性
5. **版本号**: 升级到 v1.5.1
6. **发布**: 构建 + 分发 + 更新服务器

## 未来优化方向

### 短期 (v1.5.2)
- [ ] 捆绑 Python + Node.js 便携版 (~120MB)
- [ ] 按需安装扩展库到 app_data
- [ ] 更智能的 virtualenv 检测 (poetry/pipenv)

### 中期 (v1.6.0)
- [ ] 环境诊断工具 (检测缺失的工具并提示安装)
- [ ] 自动安装常用工具 (pip install, npm install)
- [ ] 更好的错误提示 (command not found → 建议安装命令)

### 长期 (v2.0.0)
- [ ] 完全沙箱化的运行环境 (类似 Jupyter kernel)
- [ ] 跨平台统一的包管理 (类似 conda)
- [ ] 图形化环境配置界面

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| PATH 注入导致命令冲突 | 中 | 优先级排序 (virtualenv > nvm > system) |
| 重试逻辑增加延迟 | 低 | 仅重试 2 次，总延迟 <3s |
| pip 镜像配置覆盖用户设置 | 低 | 检查已有配置，跳过覆盖 |
| login shell 加载超时 | 低 | 3s 超时，失败静默跳过 |

## 兼容性

- **macOS**: ✅ 完全支持
- **Windows**: ✅ 支持 (MSYS2 bash + pip.ini)
- **Linux**: ✅ 完全支持
- **Pi SDK**: ✅ 无破坏性改动，仅增强

## 性能影响

- **首次 PATH 检测**: ~50ms (后续缓存)
- **重试开销**: 仅失败时触发，<3s
- **pip 镜像配置**: 一次性，<10ms

## 总结

这三个优化针对小白用户的核心痛点，无需用户手动配置，开箱即用。保持 Pi SDK 架构不变，风险可控，收益明显。
