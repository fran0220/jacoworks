# JAcoworks 设计系统

> 所有 UI 开发必须使用此设计 token 系统，禁止硬编码魔法数字。
> Token 定义在 `desktop/src/app.css` 的 `:root` 中。

---

## 1. 设计原则

- **暖色奶油基调**：以 `#F5F0EB` 为主背景，营造温暖亲切感
- **Claude.ai 风格**：参考 Claude.ai 的视觉语言（居中布局、大圆角、柔和阴影）
- **Token 驱动**：所有视觉属性通过 CSS 变量控制，确保一致性
- **最小复杂度**：纯 CSS + CSS Variables，无 Tailwind/UI 框架依赖

---

## 2. 颜色系统

| Token | 值 | 用途 |
|-------|-----|------|
| `--bg-primary` | `#F5F0EB` | 主背景（页面、标题栏） |
| `--bg-secondary` | `#FFFFFF` | 卡片、侧栏、输入框 |
| `--bg-tertiary` | `#EDE8E3` | 代码块头、附件芯片、hover |
| `--bg-input` | `#FFFFFF` | 输入框背景 |
| `--bg-user-bubble` | `#E8E3DD` | 用户消息气泡 |
| `--bg-assistant-bubble` | `#FFFFFF` | 助手消息气泡 |
| `--bg-hover` | `#EDE8E3` | 悬停状态 |
| `--bg-active` | `#E5E0DA` | 激活/选中状态 |
| `--bg-error` | `rgba(224,80,80,0.15)` | 错误提示背景 |
| `--bg-badge` | `rgba(196,114,74,0.12)` | 徽章背景 |
| `--bg-code` | `#0d1117` | 代码块背景（深色） |
| `--text-primary` | `#1A1A1A` | 主文字 |
| `--text-secondary` | `#5A5248` | 次要文字 |
| `--text-muted` | `#8B7E74` | 辅助文字、占位符 |
| `--text-on-accent` | `#FFFFFF` | 强调色背景上的文字 |
| `--accent` | `#C4724A` | 主强调色（陶土/珊瑚） |
| `--accent-hover` | `#B06540` | 强调色悬停 |
| `--accent-light` | `rgba(196,114,74,0.1)` | 强调色淡色 |
| `--danger` | `#D94040` | 危险/删除操作 |
| `--danger-hover` | `#C03030` | 危险色悬停 |
| `--border` | `#E0D8D0` | 主边框 |
| `--border-light` | `rgba(0,0,0,0.06)` | 轻边框（分隔线） |

---

## 3. 间距系统

基于 2px 递增的密集桌面 UI 间距阶梯，覆盖所有 padding / margin / gap 场景。

| Token | 值 | 常见用途 |
|-------|-----|---------|
| `--space-1` | `2px` | 微间距（margin-top 补偿） |
| `--space-2` | `4px` | 紧凑间距（tab-bar gap） |
| `--space-3` | `6px` | 小间距（芯片 gap、代码 padding） |
| `--space-4` | `8px` | 基础间距（按钮 gap、列表 padding） |
| `--space-5` | `10px` | 按钮内边距、列表项 |
| `--space-6` | `12px` | 表单 padding、分组间距 |
| `--space-7` | `14px` | 下拉菜单 padding |
| `--space-8` | `16px` | 标准内边距（titlebar、输入框） |
| `--space-9` | `20px` | 快捷操作间距、按钮大 padding |
| `--space-10` | `24px` | 页面水平 padding、消息气泡 |
| `--space-11` | `32px` | 大区块间距 |
| `--space-12` | `40px` | 页面垂直 padding |
| `--space-13` | `48px` | 登录卡 padding、大 hero |
| `--space-14` | `60px` | Cowork 宽页 padding |
| `--space-15` | `80px` | 底部大留白 |

**使用规则**：
- `padding` / `margin` / `gap` 必须使用 `--space-*`
- 如需非标准值，优先调整设计使其对齐到最近的 token
- 唯一例外：`0`、`auto`、百分比值

---

## 4. 字体系统

### 字号

| Token | 值 | 用途 |
|-------|-----|------|
| `--text-2xs` | `11px` | 时间戳、spinner 标签 |
| `--text-xs` | `12px` | 辅助文字、工具状态、divider |
| `--text-sm` | `13px` | 列表项、tab、下拉选项 |
| `--text-base` | `14px` | 正文（body 默认） |
| `--text-md` | `15px` | 标题栏标题、输入框 |
| `--text-lg` | `16px` | 大输入框、表单按钮 |
| `--text-xl` | `20px` | 图标文字 |
| `--text-2xl` | `24px` | Logo |
| `--text-3xl` | `28px` | 页面标题 |
| `--text-4xl` | `36px` | Hero 问候语 |

### 字重

| Token | 值 | 用途 |
|-------|-----|------|
| `--font-normal` | `400` | 正文、tab 未选中 |
| `--font-medium` | `500` | Tab 选中、按钮文字 |
| `--font-semibold` | `600` | 标题、头像字母、强调 |
| `--font-bold` | `700` | 页面大标题、Logo |

### 行高

| Token | 值 | 用途 |
|-------|-----|------|
| `--leading-none` | `1` | 图标、单行按钮 |
| `--leading-normal` | `1.5` | 输入框、代码块 |
| `--leading-relaxed` | `1.6` | Body 默认 |
| `--leading-loose` | `1.7` | Markdown 正文 |

### 字体族

| Token | 用途 |
|-------|------|
| `--font-mono` | 代码块、内联代码 |
| `--font-serif` | Hero 问候语（Georgia） |

---

## 5. 圆角系统

| Token | 值 | 用途 |
|-------|-----|------|
| `--radius-xs` | `6px` | 紧凑按钮、tab 内圆角、列表项 |
| `--radius-sm` | `4px` | 内联代码、气泡底角、小按钮 |
| `--radius` | `8px` | 标准按钮、输入框、代码块、tab-switcher |
| `--radius-md` | `10px` | 任务卡片、徽章 |
| `--radius-lg` | `12px` | 消息气泡、登录卡 |
| `--radius-xl` | `16px` | 输入卡片（Cowork/NewSession） |
| `--radius-2xl` | `20px` | 主输入卡片（ChatHome） |
| `--radius-full` | `9999px` | 头像、spinner、圆形按钮 |

---

## 6. 组件尺寸

| Token | 值 | 用途 |
|-------|-----|------|
| `--size-icon-sm` | `16px` | SVG 小图标 |
| `--size-icon` | `18px` | SVG 标准图标 |
| `--size-icon-lg` | `24px` | SVG 大图标 |
| `--size-btn-sm` | `28px` | 小按钮 |
| `--size-btn` | `32px` | 标准按钮（sidebar toggle） |
| `--size-btn-lg` | `38px` | 大按钮（发送/附件） |
| `--size-avatar-sm` | `24px` | 小头像（侧栏） |
| `--size-avatar` | `28px` | 标准头像（标题栏） |
| `--size-spinner-sm` | `10px` | 小 spinner |
| `--size-spinner` | `14px` | 标准 spinner |
| `--size-delete-btn` | `18px` | 删除按钮 |

---

## 7. 布局

| Token | 值 | 用途 |
|-------|-----|------|
| `--sidebar-width` | `280px` | 侧栏宽度 |
| `--titlebar-height` | `44px` | 标题栏高度 |
| `--content-width` | `680px` | 主内容区最大宽度 |
| `--login-width` | `380px` | 登录卡宽度 |

---

## 8. Z-Index 层级

| Token | 值 | 用途 |
|-------|-----|------|
| `--z-backdrop` | `40` | 遮罩层（drawer 背景） |
| `--z-drawer` | `50` | 抽屉侧栏 |
| `--z-titlebar` | `100` | 标题栏 |
| `--z-overlay` | `150` | 下拉菜单遮罩 |
| `--z-dropdown` | `200` | 下拉菜单 |

---

## 9. 动画

| Token | 值 | 用途 |
|-------|-----|------|
| `--duration-fast` | `0.12s` | 快速反馈（列表项 hover） |
| `--duration-normal` | `0.15s` | 标准过渡（按钮、tab） |
| `--duration-slow` | `0.2s` | 慢过渡（表单焦点、drawer 滑出） |

---

## 10. 开发规范

### 必须遵守

1. **禁止魔法数字**：所有 `padding`、`margin`、`gap`、`font-size`、`font-weight`、`border-radius`、`z-index`、`transition` duration 必须使用 token
2. **颜色必须使用变量**：禁止在组件 `<style>` 中硬编码颜色值
3. **白色文字用 `--text-on-accent`**：在强调色/危险色背景上的白色文字统一使用 `var(--text-on-accent)`

### 允许的例外

- `0`、`auto`、`100%`、`100vh`、`50%` 等结构性值
- `1px` 边框宽度
- `opacity` 值（`0.4`、`0.5`、`0.6`、`0.85` 等按上下文决定）
- `em` 相对值（Markdown 内容的 `0.5em` 等）
- SVG 属性中的数值
- `@keyframes` 动画时长和 `animation` 声明
- 组件唯一的一次性约束（如 `max-width: 200px` 附件芯片、`max-width: 140px` 文件名截断）
- `2px` / `3px` 语义边框宽度（如 blockquote 左边框、tab 底线）

### 反模式（禁止）

1. **禁止将 `--space-*` 用于 `border-radius`** — 间距和圆角是不同语义维度，必须使用 `--radius-*` 系列
2. **禁止混合阴影类型** — `--shadow-sm` / `--shadow-md` 是完整声明，`--shadow-color` 是纯颜色值，不可混用
3. **禁止在组件 `<style>` 中定义新颜色** — 所有颜色必须引用 `:root` token

### 新增 Token

如果设计需要当前 token 系统中不存在的值：
1. 优先调整设计使其对齐到最近的现有 token
2. 如确实需要新值，在 `app.css` 的 `:root` 中添加新 token，并更新本文档
3. 禁止在组件中使用 `calc()` 拼凑非标准值（除非语义明确，如 `calc(var(--size-avatar) + var(--space-4))`）
