# rpc - Process Runner Boundary

## OVERVIEW
Spawns and communicates with a child Senpi process over JSON-RPC, including model admission, protocol handling, termination, and outcome mapping.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Spawn descriptor | `spawn.ts`, `start-cleanup.ts` | Safe environment/args and pre-admission cleanup. |
| Model admission | `model-admission.ts`, `model-catalog-probe.ts` | Child-visible catalog probes and short-lived caching. |
| Protocol | `protocol-client.ts`, `parent-extensions.ts`, `ui-auto-answer.ts` | JSON-RPC requests, responses, and headless UI replies. |
| Lifecycle/outcomes | `handle.ts`, `terminate.ts`, `exit-mapping.ts`, `turn-outcome.ts` | Handle state and typed process results. |

## CONVENTIONS
- `shell: true` is forbidden; spawn descriptors carry explicit command, args, cwd, and environment.
- A timed-out catalog probe is inconclusive and is retried; catalog absence is confirmed with a fresh probe.
- Malformed protocol lines are reported/skipped without terminating the connection.
- Process signaling is separate from protocol code; lifecycle owns destruction triggers.

## ANTI-PATTERNS
- Never treat an exit-0 partial model catalog as proof of model absence.
- Never use a fallback session directory or persist executable launch inputs.
- Do not send process signals from protocol handlers.
- Keep RPC error mapping typed and preserve stderr context where available.

## HOTSPOTS
- `spawn.ts` (340 lines) builds spawn descriptors and admission inputs.
- `handle.ts` (224) and `protocol-client.ts` (221) carry connection state and request routing.
- Windows-specific behavior is isolated in dedicated fixtures under `__fixtures__/`.

## QA
```sh
bun test packages/senpi-task/src/runners/rpc
```

Parent: [`../AGENTS.md`](../AGENTS.md).
