---
name: building-skills
description: "创建和管理 Agent 技能包。当用户要求创建技能、新建 skill、编写 SKILL.md 时使用。Triggers on: 创建技能, 新建skill, create skill, build skill."
display-name: "技能构建器"
display-description: "创建和管理 Agent 技能包"
---

# 技能构建器

帮助用户创建结构良好的 Agent 技能包。

## 技能结构

每个技能需要一个 `SKILL.md` 文件，包含 YAML frontmatter：

```markdown
---
name: my-skill-name
description: Does X when Y happens. Use for Z tasks.
---

# Skill Title

Instructions go here.
```

## Frontmatter 要求

### name (必需)
- 最多 64 个字符
- 仅使用小写字母 (a-z)、数字 (0-9) 和连字符
- 不能以连字符开头或结尾，不能连续连字符
- 必须与父目录名一致
- 使用动名词形式：`processing-pdfs`、`analyzing-data`

### description (必需)
- 最多 1024 个字符（尽量简短）
- 第三人称描述（"处理文件" 而非 "我处理文件"）
- 同时说明技能做什么 AND 何时触发
- 包含关键词便于发现
- 如果包含冒号或特殊字符，用引号包裹

**好的描述：**
- "从 PDF 文件中提取文本和表格。当需要读取或编辑 PDF 时使用。"
- "查询 BigQuery 数据集。用于数据分析、SQL 查询任务。"

**差的描述：**
- "帮助处理文件"（太模糊）
- "PDF 工具"（无触发上下文）

### 可选字段
- `display-name`: 显示名称（中文友好）
- `display-description`: 显示描述
- `allowed-tools`: 技能可使用的工具列表
- `argument-hint`: 参数提示

## 目录结构

### 简单技能（仅说明）
```
vm-agent/skills/my-skill/
└── SKILL.md
```

### 带脚本的技能
```
vm-agent/skills/my-skill/
├── SKILL.md
└── scripts/
    └── my-script.sh
```

### 复杂技能（渐进式加载）
```
vm-agent/skills/my-skill/
├── SKILL.md           # 概览，500 行以内
├── reference/
│   ├── api.md         # 详细 API 文档
│   └── examples.md    # 代码示例
└── scripts/
    └── validate.py    # 可执行脚本
```

## 创建技能的工作流

1. **确认需求**：向用户确认技能名称、用途、触发条件
2. **确定安装位置**：用户自建技能安装到 `$USER_SKILLS_DIR`（见下方目录说明）
3. **创建目录**：在目标目录下创建 `<skill-name>/`
4. **编写 SKILL.md**：包含 frontmatter + 详细说明
5. **添加资源**（可选）：脚本、参考文档
6. **验证**：确保目录名与 `name` 字段一致

### 创建步骤

当用户请求创建技能时，按以下步骤操作：

```
步骤 1: 询问技能用途和名称
步骤 2: 在用户技能目录下创建 <name>/ 目录
步骤 3: 编写 SKILL.md (frontmatter + 说明)
步骤 4: 如需脚本，创建 scripts/ 目录
步骤 5: 提示用户重启 Agent 以加载新技能（新建会话即可）
```

### 从 GitHub 安装技能

当用户提供 GitHub 链接时：

```
步骤 1: 使用 web_fetch 或 git clone 获取仓库内容
步骤 2: 找到 SKILL.md 文件，验证 frontmatter 格式
步骤 3: 将整个技能目录复制到用户技能目录
步骤 4: 验证安装结果（检查目录结构和文件）
步骤 5: 提示用户新建会话以加载新技能
```

## 编写有效说明

### 应该
- 以清晰的一行摘要开头
- 列出具体能力
- 提供分步工作流
- 包含具体示例
- 用执行意图引用脚本："运行 `scripts/validate.py` 来检查..."

### 避免
- 解释模型已知的概念
- 冗长的介绍或总结
- 在主要部分包含时效性信息
- 使用抽象示例

## 渐进式加载

技能分阶段加载以节省上下文：

1. **Level 1 - 元数据**：启动时加载名称 + 描述（~100 tokens）
2. **Level 2 - 说明**：触发时加载 SKILL.md 正文（<5k tokens）
3. **Level 3 - 资源**：需要时才加载额外文件

保持 SKILL.md 在 500 行以内，大内容拆分到单独文件。

## 技能存放位置

JAcoworks 中技能从以下位置加载：

| 位置 | 类型 | 说明 |
|------|------|------|
| `vm-agent/skills/` | 内置 (builtin) | 项目预制技能，所有用户共享，不可编辑 |
| `$USER_SKILLS_DIR` | 自建 (user) | 用户创建/安装的技能，可编辑和删除 |

**用户技能目录** (`USER_SKILLS_DIR`) 默认路径：
- macOS: `~/Library/Application Support/JAcoworks/skills/`
- Windows: `%LOCALAPPDATA%/JAcoworks/skills/`
- Linux: `~/.local/share/JAcoworks/skills/`

> **重要**：用户自建技能和从 GitHub 安装的技能都应放到 `$USER_SKILLS_DIR`，不要放到 `vm-agent/skills/`。
> 可通过环境变量 `USER_SKILLS_DIR` 查看实际路径，或调用 Tauri 命令 `get_user_skills_dir` 获取。

创建或安装技能后需要重启 Agent（新建会话即可）才能生效。
