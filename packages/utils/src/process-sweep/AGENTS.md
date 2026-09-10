# process-sweep — Owned Process Cleanup

## OVERVIEW
Family-based process discovery, ownership attestation, planning, and sweeping for owned LSP daemon processes; score 11, distinct lifecycle domain with 57 exports and cross-package cleanup callers.

## WHERE TO LOOK

| Concern | Files | Notes |
|---|---|---|
| Process input | `process-table.ts`, `command-match.ts`, `exec.ts` | Parse platform output and provide kill/aliveness adapters. |
| LSP daemon versions | `lsp-daemon-family.ts` | Reads version directories and plans stale-version targets. |
| Owner proof | `lsp-daemon-owner-attestation.ts` | Authenticated endpoint, nonce, PID, and start identity checks. |
| Proxy family | `lsp-proxy-family.ts` | Selects orphaned proxy processes, not daemon servers. |
| Sweep orchestration | `family-sweeper.ts`, `sweeper.ts`, `index.ts` | Throttling, grace periods, execution, and public exports. |

## CONVENTIONS

- Keep discovery, attestation, planning, and execution separate so tests can prove each boundary independently.
- Stale-version kills require a live PID plus owner attestation; an unprovable target is spared.
- The owner-file and authenticated ping layout mirrors the sibling LSP daemon package and must change in lockstep.
- Generic argv matching may support legacy callers but never authorizes stale-version kills by itself.

## ANTI-PATTERNS

- NEVER classify the daemon server shape as an orphaned proxy; only the proxy shape is swept.
- Do not kill a process when ownership, platform support, or PID identity cannot be proven.
- Do not move version-directory removal into this utility; startup reaping owns that operation.

## COMMANDS

```bash
bun test src/process-sweep-families.test.ts src/process-sweep/*.test.ts
bun run typecheck
```
