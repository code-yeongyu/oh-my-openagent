# memory commands

The thirteen memory slash commands, registered once by the memory component through `register.ts` (`registerMemoryCommands(pi, deps)`). `MEMORY_COMMAND_NAMES`: `/memory /memfs /remember /init /doctor /recompile /memory-repository /sleeptime /reflect /dream /search /people /facts`. Score ~24 (53 files, DI surface, central registration).

## Anatomy

| Path | Purpose |
|------|---------|
| `register.ts` | Central registrar and the ONLY place command names are declared. |
| `types.ts` | `MemoryCommandDeps` / `MemoryCommandContext` / identity seams: `respond` notifications, repo access, interactivity, process liveness. |
| `args.ts` | Shared `parseCommandArgs` flag/positional parsing. |
| `backup.ts` / `repo.ts` | Repository backup and git/repository access helpers. |
| `memory.ts` / `memfs.ts` + `memfs-shared.ts` / `memfs-extra.ts` | `/memory` status; `/memfs` file tree. `/memfs` replacement is noninteractive and ALWAYS backs up first. |
| `init.ts` | `/init` - NEVER overwrites an existing memory repository. |
| `doctor.ts` / `doctor-checks.ts` | Health checks; the `facts` line stays silent at zero state. |
| `recompile.ts` / `remember.ts` / `search.ts` / `sleeptime.ts` / `reflect.ts` / `dream.ts` + `dream-staging.ts` | Single-purpose commands; `/sleeptime` shows the resolved nudge/facts/dream/people/soul settings. |
| `memory-repository.ts` | Push-only git mirror sync (the cloud-free sync story). |
| `people.ts` / `people-ask.ts` / `people-query.ts` / `people-render.ts` / `people-search.ts` + `people.test-support.ts` | People cards: query/selection, ask runner (`createPeopleAskRunner`), roster/card rendering, search hits. |
| `facts.ts` / `facts-status.ts` | `/facts` queue depth, parked/backoff counts, next eligibility, bounded per-conversation last-failure list. Corrupt `failures.json` renders as UNREADABLE, never as zeros. `/facts retry [--conversation <id>]` is the ONLY unpark path: clears failure records and fires one reconcile/launch; never moves queue data or either watermark. |
| `skill-frontmatter.ts` / `tokens.ts` | Skill-name frontmatter repair; token estimates (`estimateSystemTokens`). |
| `commands.test-support.ts` | Shared fixtures. |

## Conventions

- Handlers return `Promise<string>` command output; user notifications go only through the injected `respond` seam.
- Read-only command output never enters model context.
- Commands are centrally registered, not auto-discovered: adding one means `register.ts` + `MEMORY_COMMAND_NAMES` + a colocated test.
- Tests use deterministic fixtures, temporary repositories, and `#given/#when/#then` names.

## Commands

```bash
bun test packages/omo-senpi/src/components/memory/commands
tsgo --noEmit -p packages/omo-senpi/tsconfig.json
```
