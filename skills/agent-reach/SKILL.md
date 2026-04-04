---
name: agent-reach
description: "Internet access toolkit for AI agents. Use when the user asks to search Twitter/X, read Reddit, get YouTube transcripts, browse Bilibili, search Xiaohongshu, read web pages, or access any internet content."
---

# Agent Reach — 互联网能力

Agent Reach 已预装在此环境中。所有上游工具可直接使用。

## 快速命令参考

| 平台 | 命令 | 示例 |
|------|------|------|
| 读网页 | `curl` + Jina Reader | `curl -s "https://r.jina.ai/URL"` |
| 搜全网 | `mcporter` + Exa | `mcporter call 'exa.web_search_exa(query: "关键词", numResults: 5)'` |
| Twitter/X 搜索 | `bird` | `bird search "query" -n 10` |
| Twitter/X 读推文 | `bird` | `bird read "https://x.com/user/status/123"` |
| YouTube 字幕 | `yt-dlp` | `yt-dlp --write-sub --skip-download "URL"` |
| YouTube 元数据 | `yt-dlp` | `yt-dlp --dump-json "URL"` |
| B站 字幕 | `yt-dlp` | `yt-dlp --dump-json "https://bilibili.com/video/BVxxx"` |
| Reddit | `curl` | `curl -s "https://reddit.com/r/subreddit/top.json?limit=10"` |
| GitHub 搜索 | `gh` | `gh search repos "query" --limit 10` |
| GitHub Issue | `gh` | `gh issue view 123 --repo owner/repo` |
| RSS 订阅 | `feedparser` | `python3 -c "import feedparser; f=feedparser.parse('URL'); print(f.entries[0].title)"` |

## 诊断与管理

```bash
# 检查所有渠道状态
agent-reach doctor

# 快速健康检查 + 更新检查
agent-reach watch

# 检查新版本
agent-reach check-update

# 更新
pip3 install --break-system-packages --upgrade https://github.com/Panniantong/agent-reach/archive/main.zip
```

## 需要用户配置的功能

以下功能需要用户提供凭据才能使用：

- **Twitter 搜索/发帖**: `agent-reach configure twitter-cookies "COOKIE_STRING"` (需用户用 Cookie-Editor 导出)
- **代理** (Reddit/B站 on server): `agent-reach configure proxy http://user:pass@ip:port`
- **小宇宙播客**: `agent-reach configure groq-key gsk_xxx` (免费 Groq API Key)
- **小红书**: 需要 Docker, `docker run -d --name xiaohongshu-mcp -p 18060:18060 xpzouying/xiaohongshu-mcp`

## 注意事项

- 所有文件只写入 `~/.agent-reach/`，不要在工作区创建文件
- 不要使用 sudo，除非用户明确批准
- Cookie 等凭据只存本地，不上传
- 推荐用户使用副号登录 Twitter/小红书
