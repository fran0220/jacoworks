# OpenClaw 团队模板

存放 OpenClaw 容器的团队模板配置。每个模板定义一组协作 agents + workspace 文件 + skills。

## 目录结构

```
openclaw/
  templates/
    jamoss/                    # JaMOSS 多智能体协作团队
      template.json              # 模板元数据 (agents, cron, models, middleware)
      prompts/                   # 各角色系统提示词
        task-planner.md
        task-executor.md
        task-reviewer.md
        task-patrol.md
      skills/                    # OpenClaw AgentSkill 包
        task-planner-skill/SKILL.md
        task-executor-skill/SKILL.md
        task-reviewer-skill/SKILL.md
        task-patrol-skill/SKILL.md
      rules/                     # 团队规则 (动态可更新)
        default-rules.md
      workspace/                 # 工作区模板文件
        AGENTS.md
```

## 模板生命周期

1. **安装** — 用户选择模板 → gateway 读取 template.json → 生成 agents + cron 配置写入 openclaw.json → 创建 workspace 目录 + 文件
2. **运行** — OpenClaw cron 定时唤醒各 agent → 通过 task-cli.py 调用 JaMOSS API 协作
3. **切换** — webchat 前端通过 sessionKey (`agent:<leader-id>:main`) 切换到不同团队 leader 对话

## 新增模板

1. 在 `templates/` 下创建新目录
2. 编写 `template.json` 定义 agents 和配置
3. 创建对应的 prompts/ skills/ workspace/ 文件
4. Gateway 的模板安装 API 会读取这些文件
