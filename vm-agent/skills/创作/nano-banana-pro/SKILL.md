---
name: nano-banana-pro
display-name: 图片生成
display-description: 使用 Nano Banana 2 生成或编辑图片 (自动 fallback 到 Pro)
description: >
  Generate or edit images with Nano Banana 2 (Gemini 3.1 Flash Image, fast & cheap).
  Auto-fallback to Nano Banana Pro (Gemini 3 Pro) if fal.ai unavailable.
  Supports text-to-image and image-to-image editing.
  Use when user asks to create, generate, draw, or edit an image.
---

# 图片生成与编辑

双引擎图片生成：优先 fal-ai/nano-banana-2 (快速廉价)，失败自动 fallback 到 nano-banana-pro (最高画质)。

## 使用方法

**生成新图片：**
```bash
node {baseDir}/scripts/generate-image.mjs --prompt "图片描述" --filename "output.png"
```

**编辑已有图片：**
```bash
node {baseDir}/scripts/generate-image.mjs --prompt "编辑指令" --filename "output.png" --input-image "input.png"
```

**指定宽高比 (fal.ai)：**
```bash
node {baseDir}/scripts/generate-image.mjs --prompt "描述" --filename "output.png" --aspect-ratio 16:9
```

**指定分辨率 (仅 fallback 到 Pro 时生效)：**
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
| `--aspect-ratio` | `-a` | ❌ | 宽高比: auto(默认) / 1:1 / 16:9 / 9:16 / 4:3 / 3:4 |
| `--resolution` | `-r` | ❌ | 1K(默认) / 2K / 4K (仅 Pro fallback 时生效) |

## 引擎选择

| 引擎 | 模型 | 速度 | 画质 | 条件 |
|------|------|------|------|------|
| **Primary** | fal-ai/nano-banana-2 (Gemini 3.1 Flash) | 4-6s | 95% Pro | `FAL_KEY` 已配置 |
| **Fallback** | nano-banana-pro (Gemini 3 Pro) | 10-20s | 最高 | `LLM_PROXY_KEY` 已配置 |

脚本自动选择：FAL_KEY 有值 → nano-banana-2；失败或无 key → fallback nano-banana-pro。

## 宽高比映射 (nano-banana-2)

| 用户说法 | 参数 |
|----------|------|
| 无提及 / "自动" | `auto` |
| "方形" / "1:1" | `1:1` |
| "横屏" / "宽屏" / "16:9" | `16:9` |
| "竖屏" / "手机" / "9:16" | `9:16` |
| "4:3" / "标准" | `4:3` |

## 分辨率映射 (Pro fallback)

| 用户说法 | 参数 |
|----------|------|
| 无提及 / "低分辨率" | `1K` |
| "2K" / "中等" | `2K` |
| "高清" / "4K" / "ultra" | `4K` |

编辑模式下若未指定分辨率，脚本会根据输入图片尺寸自动选择。

## 默认工作流：draft → iterate → final

1. **草稿**: 快速验证 prompt (nano-banana-2, 几秒出图)
2. **迭代**: 微调 prompt，每次新文件名
3. **定稿**: prompt 确认后输出最终版

## 文件名规则

格式：`{timestamp}-{descriptive-name}.png`
- 时间戳：`yyyy-mm-dd-hh-mm-ss` (24小时制)
- 名称：简短描述，小写连字符

示例：
- "日本庭院" → `2026-02-27-14-23-05-japanese-garden.png`
- "机器人" → `2026-02-27-16-45-33-robot.png`

## Prompt 处理

**生成**：直接传递用户描述。仅在明显不足时补充。

**编辑**：传递编辑指令（如 "把天空变成暴风雨"、"移除背景人物"、"改为水彩风格"）。

**模板（用户描述模糊时）**：
- 生成：`"Create an image of: <主体>. Style: <风格>. Composition: <构图>. Lighting: <光线>. Background: <背景>."`
- 编辑：`"Change ONLY: <修改内容>. Keep identical: subject, composition, pose, lighting, color palette, background, text, and overall style."`

## 环境变量

| 变量 | 说明 |
|------|------|
| `FAL_KEY` | fal.ai API 密钥 (primary, 管理后台配置) |
| `LLM_PROXY_URL` | 中转站地址 (fallback) |
| `LLM_PROXY_KEY` | 中转站 API 密钥 (fallback) |

这些变量由 Tauri 启动时注入（网关 `/api/agent/config` 下发）。

## 输出

- 脚本将图片保存到指定路径
- **stdout** 输出完整文件路径（供 Agent 捕获）
- **stderr** 输出日志信息
- 生成后告知用户文件路径，**不要**读取图片内容

## 常见错误

| 错误 | 原因 | 解决 |
|------|------|------|
| `neither FAL_KEY nor LLM_PROXY_KEY` | 两个 key 都未配置 | 管理后台「系统设置」配置 fal_api_key |
| `fal API error: HTTP 401` | FAL_KEY 无效 | 检查 fal.ai 密钥 |
| `fal API error: HTTP 429` | fal.ai 限流 | 等待重试或自动 fallback 到 Pro |
| `Error loading input image` | 文件不存在或不可读 | 检查 `--input-image` 路径 |
| `Proxy API error` | 中转站异常 | 检查中转站状态 |
| `No image was generated` | 模型拒绝生成（安全过滤） | 调整 prompt |
