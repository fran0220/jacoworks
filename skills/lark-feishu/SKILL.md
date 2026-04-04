---
name: lark-feishu
description: "Feishu/Lark API via lark-cli. Use when the user asks to send messages on Feishu/Lark, upload files to Feishu Drive, manage calendar events, create tasks, or interact with any Feishu/Lark service."
---

# Lark / 飞书 — CLI 集成

`@larksuite/cli` (lark-cli) 已全局预装。通过命令行直接调用飞书开放平台 API。

## 认证初始化（仅需一次）

凭据预配置在 `~/.openclaw/credentials/lark.json`（含 app_id 和 app_secret）。

```bash
# 交互式初始化（会输出一个 URL，需用户在浏览器中打开完成授权）
lark-cli config init --new

# 验证配置状态
lark-cli auth status
```

如果 `config init` 需要 app_id/secret，从凭据文件读取：
```bash
cat ~/.openclaw/credentials/lark.json
# 按提示输入 app_id 和 app_secret
```

## 发送消息

```bash
# 发送文本到群聊
lark-cli im +messages-send --chat-id "oc_xxx" --text "你好，这是自动通知"

# 发送文本到个人 (open_id)
lark-cli im +messages-send --user-id "ou_xxx" --text "消息内容"

# 发送 Markdown 富文本
lark-cli im +messages-send --user-id "ou_xxx" --markdown "**任务完成** ✅\n详情见附件"
```

## 发送文件

```bash
# 直接发送本地文件给用户
lark-cli im +messages-send --user-id "ou_xxx" --file /path/to/report.docx

# 直接发送图片
lark-cli im +messages-send --user-id "ou_xxx" --image /path/to/screenshot.png

# 直接发送音频
lark-cli im +messages-send --user-id "ou_xxx" --audio /path/to/recording.m4a
```

## 查找用户

```bash
# 按姓名或邮箱搜索
lark-cli contact +search-user --query "张三"

# 获取用户详情
lark-cli contact +get-user --user-id "ou_xxx"

# 获取当前 bot 自身信息
lark-cli contact +get-user
```

## 日历

```bash
# 查看近期日程
lark-cli calendar +agenda

# 创建日历事件
lark-cli calendar +events-create --summary "项目评审" --start "2026-04-01T10:00:00+08:00" --end "2026-04-01T11:00:00+08:00"
```

## 任务

```bash
# 创建任务
lark-cli task +tasks-create --summary "完成文档撰写"

# 查看任务列表
lark-cli task +tasks-list
```

## 云文档

```bash
# 创建在线文档
lark-cli docs +create --title "会议纪要" --markdown "# 内容"

# 上传文件到云盘
lark-cli drive +upload --file /path/to/file.xlsx
```

## 注意事项

- 默认以 bot 身份操作（`--as bot`），加 `--as user` 切换为用户身份
- 加 `--format json` 输出 JSON，方便程序化解析
- 加 `--dry-run` 预览请求而不执行
- 群聊 ID (`oc_xxx`) 和用户 ID (`ou_xxx`) 可通过 `contact +search-user` 获取
- 所有 API 受飞书应用权限范围限制，缺少权限时会返回错误提示
