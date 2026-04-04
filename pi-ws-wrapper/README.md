# Pi WS Wrapper

`pi-ws-wrapper` runs inside an Incus VM on port `18789` and bridges `oc-gateway` WebSocket traffic to local `pi --mode json` processes.

## Purpose

- Keep the existing `oc-gateway -> VM :18789` relay shape.
- Reuse long-lived Pi CLI processes per `session_id`.
- Forward Pi JSONL output upstream with an added `session_id` field.

## HTTP And WebSocket API

- `GET /health` -> `{"status":"ok","sessions":N}`
- `GET /ws?token=...` -> authenticated WebSocket bridge

Client messages:

```json
{"type":"prompt","session_id":"abc","message":"hello"}
{"type":"abort","session_id":"abc"}
```

Server messages:

```json
{"type":"session_ready","session_id":"abc"}
{"type":"session","session_id":"abc","version":3,"id":"..."}
{"type":"message_update","session_id":"abc", ...}
{"type":"agent_end","session_id":"abc", ...}
{"type":"session_error","session_id":"abc","error":"..."}
```

## Runtime Behavior

- Spawns `pi --mode json` on the first prompt for a `session_id`.
- Writes each prompt to Pi stdin as a plain text line.
- Streams each Pi stdout JSON object back over WebSocket.
- Sends `SIGINT` to the matching Pi process on `abort`.
- Kills idle sessions after 30 minutes.

## Environment

- `WS_WRAPPER_TOKEN` - required WebSocket bearer replacement, passed as `?token=`
- `LLM_PROXY_KEY` - forwarded to the Pi process environment
- `PORT` - optional, defaults to `18789`
- `PI_WORKSPACE_DIR` - optional, defaults to `/data/workspace`

## Local Development

```bash
cd pi-ws-wrapper
WS_WRAPPER_TOKEN=dev-token LLM_PROXY_KEY=test bun server.ts
```

## Deployment

The golden image / provision flow should copy this directory to `/opt/pi-ws-wrapper/` and install [`pi-ws-wrapper.service`](./pi-ws-wrapper.service) as a systemd unit.
