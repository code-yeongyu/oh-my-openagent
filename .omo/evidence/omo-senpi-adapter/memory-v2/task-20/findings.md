# Task 20: docs + divergence consistency audit

Audited against HEAD 755d55dc1 (worktree feat/memory-v2-active-learning). Other agents had
uncommitted changes in `components/memory/` (people-* commands, register.ts, index.ts); every
claim below was verified against COMMITTED code (`git show HEAD:` where the working tree was
dirty), never against in-flight work.

## Configuration reference vs schema

`docs/reference/configuration.md` `### Memory` section cross-checked key by key against
`packages/omo-config-core/src/schema/memory.ts`:

| Doc value | Schema line | Verdict |
|---|---|---|
| `enabled: true`, `agent: "auto"`, `tool_exposure: "direct"` | memory.ts:159-163 | match |
| reflection 25 / on_compaction true / auto / quick / 15 / auto | memory.ts:8-19 | match |
| nudge true / every_user_turns 10 | memory.ts:38-41 | match |
| facts true / debounce_settles 4 | memory.ts:47-50 | match |
| dream true / 30 / 24 / true / 5 / 150000 | memory.ts:56-63 | match |
| people true / max_entries 40 (1-100) / max_entry_chars 200 (50-500) | memory.ts:69-73 | match |
| soul edit_notice true | memory.ts:79-81 | match |
| sync.enabled true, sync.remote optional, search.enabled true | memory.ts:25-32 | match |
| compile_warn_tokens 30000, agents {} | memory.ts:186-187 | match |

`auto_select_max_chars` described as a byte budget: confirmed, dream-selector.ts:227 uses
`Buffer.byteLength(text, "utf8")`. Nudge threshold semantics (`turns >= everyUserTurns`)
confirmed at nudge-wiring.ts:124. NO drift found; zero configuration.md edits needed.

## AGENTS.md drift found and fixed

1. Anatomy table predated memory v2: added rows for the run supervisor pipeline (worker/
   memory-run-supervisor.ts, launch manifest, gated bootstrap, outcome/final sentinels,
   win32 taskkill containment: memory-run-supervisor.ts:53,58,149,171), nudge-wiring.ts,
   facts-wiring.ts + facts-runner.ts, dream-selector.ts (selectDreamConversations:131),
   skills-usage.ts, soul-notice.ts, shutdown-drain.ts.
2. `commands/` row: "Ten slash commands" is still true at HEAD (MEMORY_COMMAND_NAMES has 10
   entries, `git show HEAD:.../commands/register.ts`); noted /sleeptime now shows
   nudge/facts/dream/people/soul (sleeptime.ts, todo 5).
3. Divergence #6: NOT lifted. `/dream --auto` and `--to` are NOT registered at HEAD
   (reflect.ts:5 "deliberately no --auto selector"; no dream command in register.ts). The
   plan's "partially lifted" wording describes todo 10, still in flight. Row updated only to
   point at the dream-pass extension; the slash-surface divergence stands.
4. New "Extensions beyond parity" section: nudge, facts extractor, dream pass (trigger kind
   "dream" + origin, machine.ts:3; selector caps), people cards (people/format.ts, IC-16
   limits API), soul v2 (identity.md in <self>, edit notices, soul-notice.ts:1-9), MCP search
   surface (tools.ts:109-123, tool-surface.test.ts), run supervisor Windows semantics
   (win32 always-UNKNOWN identity -> abandoned.json per IC-9; bootstrap self-enforcement).
5. New "Deliberate constants" section: facts category pinned "quick"
   (facts-runner.ts:38 QUICK_CATEGORY + schema comment memory.ts:44) and shutdown drain
   budget 1500 ms (shutdown-drain.ts:11 SESSION_SHUTDOWN_DRAIN_BUDGET_MS).
6. step_count: recorded as staying at letta's 25 (schema memory.ts:8), per the plan's
   "restored to letta 25" note.
7. Em dashes removed from divergence rows 10 and 11 (repo prose convention).

## Docs gaps left for not-yet-landed todos (deliberate, not documented ahead)

- /dream slash command (--auto, --to): todo 10 in flight; divergence #6 kept.
- /people commands: untracked people-*.ts in the working tree belong to another agent's
  in-flight todo; command count kept at ten.
- Idle/shutdown dream trigger wiring: `dream.idle_minutes` / `shutdown_launch` exist in the
  schema and defaults only (index.ts:40-42, identity-runtime.ts:43-45); no scheduler consumes
  them at HEAD. configuration.md's dream intro sentence describes the keys' intended gate;
  left as is since the keys are real, flagged here for the landing todo.

## Verification

- `bun test packages/omo-opencode/src/shared/markdown-link-audit.test.ts`: 16 pass, 0 fail.
- `bun test script/agents-md-dev-env.test.ts`: 4 pass, 0 fail.
- `bun test packages/omo-senpi/src/components/memory`: 365 pass, 1 fail. The failure
  (index.test.ts "enablement latched... restart notice appears once") exercises index.ts and
  wiring.ts, both carrying ANOTHER agent's uncommitted edits at run time. A docs-only
  AGENTS.md change cannot reach it. Pre-existing/in-flight, flagged, not fixed here.
- QA failure path: N/A, prose; the two audits above are the machine gate (test-discipline
  bans phrase pins for prose).

## QA-by-read checklist (key -> doc section)

Every schema key and its documenting section, read side by side:
enabled/agent/tool_exposure/compile_warn_tokens/agents -> "Memory" root table;
reflection.enabled/trigger.step_count/trigger.on_compaction/merge/category/timeout_minutes/
sandbox -> "Reflection"; nudge.enabled/every_user_turns -> "Nudge";
facts.enabled/debounce_settles -> "Facts"; dream.enabled/idle_minutes/min_hours_between/
shutdown_launch/auto_select_max/auto_select_max_chars -> "Dream";
people.enabled/max_entries/max_entry_chars -> "People"; soul.edit_notice -> "Soul";
sync.enabled/sync.remote/search.enabled -> "Sync and Search". No schema key is undocumented;
no documented key is absent from the schema.
