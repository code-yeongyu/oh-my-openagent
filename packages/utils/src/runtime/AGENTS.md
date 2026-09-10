# runtime — Portable Process and File Adapters

## OVERVIEW
Bun/Node compatibility seams for spawning processes, reading and writing files, command lookup, and Windows Git Bash resolution; score 11, distinct runtime boundary imported across sibling packages.

## WHERE TO LOOK

| Task | File | Notes |
|---|---|---|
| Spawn a child process | `spawn.ts` | `spawn`/`spawnSync` normalize Bun and Node result shapes. |
| Configure stdio | `spawn.ts` | Uses `shell: false`; map explicit stdin/stdout/stderr modes. |
| File access | `file.ts` | `bunFile` and `bunWrite` provide the portable file seam. |
| Command lookup | `which.ts` | Resolves executable candidates without shell evaluation. |
| Git Bash | `git-bash.ts` | Resolves explicit env, Program Files, and safe PATH candidates. |
| Public surface | `index.ts` | Re-exports the runtime adapter modules. |

## CONVENTIONS

- Prefer the global Bun runtime when present and fall back to Node APIs without changing the public result shape.
- Preserve readable streams, exit promises, kill/ref/unref behavior, and Windows `windowsHide` semantics.
- Keep command arguments structured; callers must not depend on shell interpolation.
- Add platform-specific behavior behind injectable platform/options inputs so tests stay deterministic.

## ANTI-PATTERNS

- Do not set `shell: true` or concatenate untrusted command text.
- Do not assume Bun-only APIs in code consumed by Electron-hosted or Node processes.
- Do not make callers inspect Bun-specific process fields; normalize at this boundary.

## COMMANDS

```bash
bun test src/runtime/*.test.ts
bun run typecheck
```
