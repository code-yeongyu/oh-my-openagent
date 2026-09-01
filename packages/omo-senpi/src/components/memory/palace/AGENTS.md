# memory palace

Self-contained HTML memory viewer: one generated artifact with embedded data, script, and styles - no external assets, no server. Distinct domain (pure generation/rendering, no git mutation), score ~16.

## Anatomy

| Path | Purpose |
|------|---------|
| `index.ts` | Barrel: command registration, collector APIs/types, generation/rendering/encoding, people exports. |
| `command.ts` | `/palace` command (`registerPalaceCommand`, wired from memory wiring): generates the artifact and reports/opens it. Command output text NEVER enters model context when no UI is attached. |
| `generator.ts` | HTML assembly: `generatePalaceHtml` / `renderPalaceHtml` / `encodePalaceData` over the collected data. |
| `template.ts` | Page skeleton with machine-gated inline-JSON embedding points. |
| `client-script.ts` / `styles.ts` | Inlined client behavior and styling - no external requests. |
| `collectors.ts` | Orchestration: `collectPalaceData` over the memory repo. |
| `people.ts` | People graph collection (`collectPeople`) backing the relationship view. |
| `entry-collector.ts` | Memory entry collection. |
| `reflection-collector.ts` | Reflection run/outcome collection. |
| `history-collector.ts` | Git history collection, hard-capped: `HISTORY_MAX_COMMITS = 500`, `HISTORY_RECENT_DIFFS = 50`, plus per-diff and total payload caps. |
| `palace.test-support.ts` | Shared fixtures. |

## Conventions

- Artifact permissions 0600/0700; inline-JSON embedding is machine-gated with escaping/injection tests.
- Consumers import the barrel or the narrow `./command` / `./people` paths.
- Colocated Bun tests (`*.test.ts`) pin escaping, caps, and rendered structure.

## Commands

```bash
bun test packages/omo-senpi/src/components/memory/palace
```
