---
name: nano-banana-pro
display-name: 图片生成
display-description: 使用 Nano Banana Pro 生成或编辑图片
description: >
  Generate or edit images with Nano Banana Pro (Gemini 3 Pro Image Preview).
  Supports text-to-image and image-to-image editing.
  Resolution: 1K (default), 2K, 4K.
  Use when user asks to create, generate, draw, or edit an image.
---

# Nano Banana Pro — 图片生成与编辑

通过 LLM 中转站调用 Gemini 3 Pro Image Preview 模型生成/编辑图片。

## 使用方法

**生成新图片：**
```bash
node {baseDir}/scripts/generate-image.mjs --prompt "图片描述" --filename "output.png"
```

**编辑已有图片：**
```bash
node {baseDir}/scripts/generate-image.mjs --prompt "编辑指令" --filename "output.png" --input-image "input.png"
```

**指定分辨率：**
```bash
node {baseDir}/scripts/generate-image.mjs --prompt "描述" --filename "output.png" --resolution 4K
```

> **重要**：始终在用户工作目录下运行，让图片保存到用户所在位置。

## 参数

| 参数 | 短写 | 必须 | 说明 |
|------|------|------|------|
| `--prompt` | `-p` | ✅ | 图片描述或编辑指令 |
| `--filename` | `-f` | ✅ | 输出文件名 (含路径) |
| `--input-image` | `-i` | ❌ | 待编辑的输入图片路径 |
| `--resolution` | `-r` | ❌ | 1K (默认) / 2K / 4K |

## 分辨率映射

| 用户说法 | 参数 |
|----------|------|
| 无提及 / "低分辨率" / "1080p" | `1K` |
| "2K" / "2048" / "中等" | `2K` |
| "高清" / "高分辨率" / "4K" / "ultra" | `4K` |

编辑模式下若未指定分辨率，脚本会根据输入图片尺寸自动选择。

## 默认工作流：draft → iterate → final

1. **草稿 (1K)**: 快速验证 prompt
2. **迭代**: 微调 prompt，每次新文件名
3. **定稿 (4K)**: prompt 确认后输出高清版

## 文件名规则

格式：`{timestamp}-{descriptive-name}.png`
- 时间戳：`yyyy-mm-dd-hh-mm-ss` (24小时制)
- 名称：简短描述，小写连字符

示例：
- "日本庭院" → `2026-02-25-14-23-05-japanese-garden.png`
- "机器人" → `2026-02-25-16-45-33-robot.png`

## Prompt 处理

**生成**：直接传递用户描述。仅在明显不足时补充。

**编辑**：传递编辑指令（如 "把天空变成暴风雨"、"移除背景人物"、"改为水彩风格"）。

**模板（用户描述模糊时）**：
- 生成：`"Create an image of: <主体>. Style: <风格>. Composition: <构图>. Lighting: <光线>. Background: <背景>."`
- 编辑：`"Change ONLY: <修改内容>. Keep identical: subject, composition, pose, lighting, color palette, background, text, and overall style."`

## 环境变量

| 变量 | 说明 |
|------|------|
| `LLM_PROXY_URL` | 中转站地址 (默认 `http://67.230.171.248:8317`) |
| `LLM_PROXY_KEY` | 中转站 API 密钥 (必须) |

这些变量由 Tauri 启动时注入（网关 `/api/agent/config` 下发或回退 `.env`）。

## 输出

- 脚本将 PNG 保存到指定路径
- **stdout** 输出完整文件路径（供 Agent 捕获）
- **stderr** 输出日志信息
- 生成后告知用户文件路径，**不要**读取图片内容

## 常见错误

| 错误 | 原因 | 解决 |
|------|------|------|
| `LLM_PROXY_KEY is required` | 环境变量未设置 | 检查 Agent 启动配置 |
| `Error loading input image` | 文件不存在或不可读 | 检查 `--input-image` 路径 |
| `HTTP 4xx/5xx` | API 配额/权限/模型不可用 | 检查中转站状态 |
| `No image was generated` | 模型拒绝生成（安全过滤） | 调整 prompt |
