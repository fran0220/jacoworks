# vm-agent — Deprecated Reference

> `vm-agent` 已被 Pi CLI + `pi-config/` + `pi-ws-wrapper/` 替代。此目录当前仅保留给 code review、回滚对照和迁移参考，不再属于任何生产链路。

## 当前状态

- 桌面端主链路已改为 Tauri sidecar 直接拉起 `pi --mode json`
- WebChat 主链路已改为 oc-gateway → VM `pi-ws-wrapper` (:18789)
- `make deploy-oracle` 已退役，oracle 上的 vm-agent Docker 不再是正式部署目标

## 在这个目录里允许做什么

- 读取旧实现，对照 Pi 迁移前后的行为
- 提取旧扩展、旧测试、旧提示词用于迁移
- 在明确要求下修复阻塞 review 的兼容性问题

## 不要再做什么

- 不要新增面向生产的新功能
- 不要继续扩展旧 RPC 协议
- 不要把这里当成 Desktop 或 WebChat 的当前运行时文档

## 迁移后的对应位置

- 共享 Pi 配置: `pi-config/`
- VM 侧 WS 入口: `pi-ws-wrapper/`
- 通用技能: `skills/`
- Desktop sidecar: `desktop/src-tauri/src/sidecar.rs`
- WebChat relay: `gateway/internal/pi/` 与 `gateway/internal/agent/ws_handler.go`

更多背景见 `vm-agent/DEPRECATED.md`。
