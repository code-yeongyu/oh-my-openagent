# src - senpi-task Runtime Surface

## OVERVIEW
The direct `src/` files form the package barrel and small cross-cutting render/status helpers; subsystem rules live in child guides.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Public package imports | `index.ts` | Re-export-only root barrel; keep the `SIZE_OK` marker. |
| Status/progress text | `status-line.ts`, `progress.ts`, `renderer-text.ts` | Presentation helpers used by tools and integrations. |
| Task summaries and notices | `task-summary.ts`, `notice-box.ts` | Shared limits and terminal display formatting. |
| Subsystem behavior | `state/`, `store/`, `manager/`, `lifecycle/` | Use the nearest child guide before editing. |

## CONVENTIONS
- `index.ts` separates runtime exports from `export type` blocks and is the package's stable root API.
- Relative imports are extensionless ESM; cross-package dependencies use workspace aliases.
- Direct tests are colocated as `*.test.ts` and use `bun:test`.

## ANTI-PATTERNS
- Do not add implementation to the root barrel; keep it re-export-only.
- Do not expose a new deep path without updating the package export map and its consumer contract.
- Do not import `packages/omo-opencode` from this package.

## HOTSPOTS
- `index.ts` (533 lines) is the single largest direct file and carries the whole public surface.
- `run-stats.ts` (226) and `progress.ts` (173) concentrate token/cost accounting and live activity formatting.
- Subsystem complexity lives in `manager/`, `dag/`, and `lifecycle/`, not in these direct files.

## COMMANDS
```sh
tsgo --noEmit -p packages/senpi-task/tsconfig.json
bun test packages/senpi-task
```

Parent: [`../AGENTS.md`](../AGENTS.md).
