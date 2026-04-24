# 工具使用要点

<!-- JAco 在使用工具时会参考这些笔记 -->

## 搜索与生成

- 搜索/调研: 直接用 `web_search` 工具
- 图片生成/编辑: 直接用 `generate_image` 工具
- 视频生成: 直接用 `generate_video` 工具
- 浏览器操作: 加载 browser / agent-browser skill，再通过 CLI 完成交互
- 文档处理: 优先走 skill 指导下的 bash / python 工作流

## 记忆

- memory_search: 语义搜索过往记忆
- memory(action="add"): 保存重要信息 (用户偏好、项目约定、关键决策)
- memory(action="replace"): 更新已有记忆条目 (子串匹配)
- memory(action="remove"): 删除过时记忆条目 (子串匹配)
- 记忆预算约 3000 字符，接近上限时优先合并/替换而非追加

## 定时任务

- cron_manage: 创建/列出/删除/运行定时任务
- 调度类型: cron (标准表达式) / at (一次性) / every (固定间隔)
