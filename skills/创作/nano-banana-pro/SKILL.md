---
name: nano-banana-pro
description: >
  生成或编辑高质量图片。
  Generate or edit images using the built-in generate_image tool.
  Supports text-to-image and image-to-image editing.
  Use when user asks to create, generate, draw, or edit an image.
---

# 图片生成与编辑

JAcoworks 内置 `generate_image` 工具，支持文生图和图片编辑。

## 使用方法

直接调用 `generate_image` 工具，无需运行脚本。

**生成新图片：**
```
generate_image(prompt="图片描述", filename="output.png")
```

**编辑已有图片：**
```
generate_image(prompt="编辑指令", filename="output.png", input_image="input.png")
```

**指定宽高比：**
```
generate_image(prompt="描述", filename="output.png", aspect_ratio="16:9")
```

## 参数

| 参数 | 必须 | 说明 |
|------|------|------|
| `prompt` | ✅ | 图片描述或编辑指令 |
| `filename` | ✅ | 输出文件路径 (相对工作目录或绝对路径) |
| `input_image` | ❌ | 待编辑的输入图片路径 |
| `aspect_ratio` | ❌ | auto(默认) / 1:1 / 16:9 / 9:16 / 4:3 / 3:4 |

## 宽高比映射

| 用户说法 | 参数 |
|----------|------|
| 无提及 / "自动" | `auto` |
| "方形" / "1:1" | `1:1` |
| "横屏" / "宽屏" / "16:9" | `16:9` |
| "竖屏" / "手机" / "9:16" | `9:16` |
| "4:3" / "标准" | `4:3` |

## 连续编辑（重要）

当用户要求修改**之前生成的图片**（如"把背景换成蓝色"、"加个帽子"、"改成卡通风格"），**必须**：
1. 从对话历史中找到上次 `generate_image` 返回的文件路径
2. 将该路径作为 `input_image` 传入，配合新的编辑 prompt
3. 使用新文件名输出（保留原图）

示例对话：
```
用户: 画一只猫
→ generate_image(prompt="a cat", filename="2026-03-14-10-00-00-cat.png")
→ ✅ Image saved: /workspace/2026-03-14-10-00-00-cat.png

用户: 给它戴个墨镜
→ generate_image(prompt="Add cool sunglasses to the cat. Keep everything else identical.", filename="2026-03-14-10-01-00-cat-sunglasses.png", input_image="2026-03-14-10-00-00-cat.png")
```

**判断依据**：用户说"改一下"、"加个XX"、"换成XX风格"、"去掉XX"等修改类指令，且对话中有之前生成的图片 → 用编辑模式。用户描述全新画面 → 用生成模式。

## 工作流

**默认**：单次生成，直接输出结果。不要自动迭代。

**仅当用户明确要求迭代**（如"先出草稿"、"帮我多试几版"）时，才使用多步工作流：
1. **草稿**: 快速验证 prompt
2. **迭代**: 微调 prompt，每次新文件名
3. **定稿**: prompt 确认后输出最终版

⚠️ 禁止未经用户要求就连续多次调用 `generate_image`。一次请求 = 一次调用。

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

## 输出

- 工具将图片保存到指定路径并返回文件路径和大小
- 生成后告知用户文件路径，**不要**读取图片内容

## 常见错误

| 错误 | 原因 | 解决 |
|------|------|------|
| `no image generation API key configured` | 密钥未配置 | 联系管理员在「系统设置」中配置 |
| `all image generation methods failed` | 生成失败 | 检查网络或稍后重试 |
