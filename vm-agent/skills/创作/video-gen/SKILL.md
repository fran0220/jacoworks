---
name: video-gen
display-name: 视频生成
display-description: 使用 Seedance 2.0、Kling 3.0 Pro 或 Veo 3.1 生成高质量视频 (文生视频 / 图生视频 / 首尾帧动画)
description: >
  Generate high-quality videos using Seedance 2.0, Kling 3.0 Pro or Google Veo 3.1.
  Supports text-to-video, image-to-video, and first-last-frame animation.
  Use when user asks to create, generate, or make a video, animation, or motion clip.
---

# 视频生成

调用 Seedance 2.0、Kling 3.0 Pro 和 Google Veo 3.1 生成高质量视频。

> **面向用户隐藏内部细节** — 对话中只提模型品牌名 (Seedance / Kling / Veo)，不暴露 fal.ai、即梦网关、端点地址、API 细节。

## 使用方法

### Seedance 2.0 (推荐, 需要至少一张图片)

**图生视频：**
```bash
node {baseDir}/scripts/generate-video-seedance.mjs --prompt "让@1中的主体缓慢转头微笑" --filename "output.mp4" --input-image "photo.png"
```

**多素材：**
```bash
node {baseDir}/scripts/generate-video-seedance.mjs --prompt "让@1和@2互动" --filename "output.mp4" -i "a.png" -i "b.png" --duration 5 --aspect-ratio 16:9
```

### Kling / Veo (fal.ai)

**文生视频：**
```bash
node {baseDir}/scripts/generate-video.mjs --prompt "描述" --filename "output.mp4" --model veo31-t2v
```

**图生视频：**
```bash
node {baseDir}/scripts/generate-video.mjs --prompt "描述" --filename "output.mp4" --model veo31-i2v --input-image "photo.png"
```

**首尾帧动画：**
```bash
node {baseDir}/scripts/generate-video.mjs --prompt "描述" --filename "output.mp4" --model veo31-flf --input-image "start.png" --end-image "end.png"
```

> **重要**：始终在用户工作目录下运行，让视频保存到用户所在位置。

## 参数

| 参数 | 短写 | 必须 | 说明 |
|------|------|------|------|
| `--prompt` | `-p` | ✅ | 视频描述 |
| `--filename` | `-f` | ✅ | 输出文件名 (含路径) |
| `--model` | `-m` | ✅ | 模型别名 (用户选择, 见模型列表) |
| `--input-image` | `-i` | 视情况 | 起始帧/参考图片路径 (图生视频/首尾帧必须) |
| `--end-image` | `-e` | 视情况 | 结束帧图片路径 (首尾帧必须) |
| `--duration` | `-d` | ❌ | 时长 (Kling: 3-15, Veo: 4s/6s/8s) |
| `--aspect-ratio` | `-a` | ❌ | 宽高比: 16:9(默认) / 9:16 / 1:1 |
| `--resolution` | `-r` | ❌ | 分辨率: 720p / 1080p(默认) / 4k (仅 Veo) |
| `--audio` | | ❌ | on(默认) / off |

## 模型列表 (内部映射, 不暴露端点给用户)

| 别名 | 脚本 | 类型 | 面向用户的名称 |
|------|------|------|---------------|
| (Seedance) | generate-video-seedance.mjs | 图生视频 | **Seedance 2.0** 图生视频 |
| `veo31-t2v` | generate-video.mjs | 文生视频 | Veo 3.1 文生视频 |
| `veo31-i2v` | generate-video.mjs | 图生视频 | Veo 3.1 图生视频 |
| `veo31-flf` | generate-video.mjs | 首尾帧 | Veo 3.1 首尾帧动画 |
| `kling-v3-t2v` | generate-video.mjs | 文生视频 | Kling V3 文生视频 |
| `kling-v3-i2v` | generate-video.mjs | 图生视频 | Kling V3 图生视频 |
| `kling-o3-i2v` | generate-video.mjs | 首尾帧 | Kling O3 首尾帧动画 |

## 交互流程

### Step 1: 展示模型菜单

当用户要求生成视频时，**先展示菜单让用户选**，不要自动选模型：

> 📹 **请选择视频模型：**
>
> **一、图生视频** (需要 1+ 张图片, 推荐)
> 1. **Seedance 2.0** ⭐ — 电影感运镜, 支持多素材 @1 @2 引用, 5s
>
> **二、文生视频** (纯文字，无需图片)
> 2. **Veo 3.1** — 4K, 原生音频, 时长 4/6/8s
> 3. **Kling V3** — 灵活时长 3-15s, 多段提示词
>
> **三、图生视频** (需要 1 张图片)
> 4. **Veo 3.1** — 4K, 原生音频, 时长 4/6/8s
> 5. **Kling V3** — 支持 @Element 元素保留, 时长 3-15s
>
> **四、首尾帧动画** (需要 2 张图片: 起始帧 + 结束帧)
> 6. **Veo 3.1** — 4K, 原生音频, 时长 4/6/8s
> 7. **Kling O3** — 运动引擎, 自然过渡, 5s

### Step 2: 告知所需素材

用户选定后，告知需要准备什么：

| 选择 | 需要准备 |
|------|---------|
| Seedance 2.0 (1) | 1+ 张图片 + 视频描述 (prompt 中用 @1 @2 引用素材) |
| 文生视频 (2/3) | 视频描述即可 |
| 图生视频 (4/5) | 1 张起始图片 + 视频描述 |
| 首尾帧动画 (6/7) | 2 张图片 (起始帧 + 结束帧) |

图片格式: PNG / JPG / WebP，建议 1080p 以上。

### Step 3: 素材齐全后直接生成

无需二次确认，收到素材和描述后直接执行。生成较慢 (1-5 分钟)，告知用户正在等待。

## Prompt 处理

**直接传递用户描述**。仅在明显不足时补充场景/运镜/光线。

**好的视频 prompt 包含**:
1. **主体动作**: 谁在做什么 (a cat jumping onto a table)
2. **场景环境**: 在哪里 (cozy living room, golden hour light)
3. **运镜方式**: 镜头怎么动 (slow zoom in, tracking shot, static)
4. **氛围风格**: 什么感觉 (cinematic, documentary, dreamy)

**模板（用户描述模糊时）**:
```
"[主体] [动作] in [场景]. [运镜]. [氛围/风格]. [时间/光线]."
```

示例: "A golden retriever running through autumn leaves in a forest path. Slow-motion tracking shot. Warm cinematic look. Late afternoon golden light."

## 文件名规则

格式：`{timestamp}-{descriptive-name}.mp4`
- 时间戳：`yyyy-mm-dd-hh-mm-ss` (24小时制)
- 名称：简短描述，小写连字符

示例：
- "猫跳桌子" → `2026-02-27-14-23-05-cat-jumping.mp4`
- "日落延时" → `2026-02-27-16-45-33-sunset-timelapse.mp4`

## 默认工作流

1. **展示菜单**: 向用户展示 6 个模型的完整菜单，按场景分组
2. **用户选择**: 等用户选定模型 (或说"帮我推荐")
3. **素材确认**: 根据所选模型检查素材是否齐全
4. **参数确认**: 展示确认摘要 (模型+参数+费用)，等用户确认
5. **生成**: 提交队列 → 轮询状态 (每 3s) → 下载 MP4
6. **交付**: 告知用户文件路径，**不要**尝试播放视频

> 视频生成较慢 (通常 1-5 分钟)，生成中告知用户正在等待。

## 环境变量

| 变量 | 说明 |
|------|------|
| `FAL_KEY` | fal.ai 视频生成 API 密钥 (Kling / Veo **必须**) |
| `JIMENG_API_URL` | 即梦网关地址 (默认 `http://185.200.65.233:5100`) |
| `JIMENG_API_KEY` | 即梦网关 API 密钥 (Seedance **必须**) |

由 Tauri 启动时注入（网关 `/api/agent/config` 下发）。

## 输出

- 脚本将视频保存到指定路径
- **stdout** 输出完整文件路径（供 Agent 捕获）
- **stderr** 输出日志信息 (队列状态、轮询进度)
- 生成后告知用户文件路径，**不要**尝试读取或播放视频内容

## 常见错误

| 错误 | 原因 | 解决 |
|------|------|------|
| `JIMENG_API_KEY not configured` | 未配置即梦网关密钥 | 管理后台「系统设置」配置 |
| `Seedance 2.0 需要至少一个文件` | 未提供 `--input-image` | 提供至少一张图片 |
| `FAL_KEY not configured` | 未配置视频 API 密钥 | 管理后台「系统设置」配置 |
| `HTTP 401` | API 密钥无效 | 联系管理员检查密钥配置 |
| `HTTP 429` | API 限流 | 等待后重试 |
| `Queue timeout` | 生成超时 (>10min) | 重试或换较短时长 |
| `Input image required` | 图生视频/首尾帧缺图 | 提供 `--input-image` |
| `End image required` | 首尾帧缺结束帧 | 提供 `--end-image` |
| `Content moderation` | 内容安全过滤 | 调整 prompt |
| `Invalid duration` | Veo 只支持 4/6/8s | 调整时长或切换到 Kling |
