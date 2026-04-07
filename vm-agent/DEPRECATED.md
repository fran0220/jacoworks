# vm-agent Deprecation Note

`vm-agent` was the previous Bun/Pi-SDK wrapper used by both Desktop and the old cloud agent path. The repository now standardizes on:

- `pi --mode json` for Desktop local sessions
- `pi-config/` for shared model/settings/extensions
- `pi-ws-wrapper/` for VM-side WebSocket access on `:18789`
- top-level `skills/` for shared skill content

This directory remains in-tree temporarily so reviewers can:

- compare old RPC behavior with the Pi CLI migration
- port remaining helpers or tests if needed
- audit removed code paths before final deletion

It is no longer a supported deployment target. New work should happen in the Pi-based paths listed above.
