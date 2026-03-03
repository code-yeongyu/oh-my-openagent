# Skill Evolution Plan

**Status**: Phases 1–5.1 COMPLETE ✅ | Phase 5.2 (boomerang full) DEFERRED — awaiting L1 real-world data
**Created**: 2026-02-26
**Updated**: 2026-03-03 (Phase 4+5 verified live; real-world skills created)
**Branch**: `feat/skill-manage` in `nous-labs/oh-my-opencode` fork

---

## Research Sources

| Source | Key Finding |
|--------|-------------|
| obra/superpowers | Bootstrap-on-every-turn via `experimental.chat.system.transform`; 1% rule as mandate not suggestion; skills as state machines with prose Terminal States |
| blog.fsck.com/2025/11/24 | Subagent isolation for context pollution; plan-as-memory pattern; Controller/Worker amnesia |
| OMC #2178 (context GC tiering) | HOT→WARM→COLD→GONE — memory_tags bridges memory tier and skill relevance |
| OMC #10542 (skill→MCP chain) | Community demand for deterministic skill sequencing |
| OMC #1397 (learning capture) | Community demand for skills that learn from session outcomes |
| OMC #2162 (event subscriptions) | `subscriptions: string[]` pattern — hooks only fire for relevant events; 10x dispatch reduction |
| OMC #2164 (TOON compression) | 30-80% token reduction for structured data (draft, complex — deferred) |
| OMC #2245 (Coeus planner) | Controller/Worker pattern formalized as agent (RFC — monitor only) |
| OpenCode `experimental.chat.system.transform` | Fires every LLM turn; push to `output.system[]`; already stubbed in our fork at `src/plugin/system-transform.ts` |
| Prior research (sessions ses_3500*) | OpenCode vanilla docs, OMC deepwiki, upstream codebase, hermes+agentskills.io, Metis/Oracle
---

## Phase 1 — COMPLETE ✅

All items verified in codebase (`feat/skill-manage`, audited 2026-03-03):

| File | LOC | Status |
|------|-----|--------|
| `src/tools/skill-manage/tools.ts` | 177 | ✅ create/edit/delete/list/read/search ops |
| `src/tools/skill-manage/types.ts` | 16 | ✅ |
| `src/hooks/auto-slash-command/skill-command.ts` | 91 | ✅ `/skill [query]` discovery command |
| `src/features/builtin-skills/skills/writing-skills.ts` | 162 | ✅ meta-skill for authoring skills |
| `src/hooks/compaction-skill-injector/hook.ts` | 51 | ✅ BOC — reinjects skill index at compaction |
| `src/hooks/category-skill-reminder/hook.ts` | 142 | ✅ reactive reminder after 3+ tool calls |
| `src/tools/skill/tools.ts` | — | ✅ `clearSkillToolCaches()` exported |
| `src/shared/agent-tool-restrictions.ts` | — | ✅ `skill_manage` in `EXPLORATION_AGENT_DENYLIST` |
| `src/plugin/system-transform.ts` | 19 | ✅ injects skill index + 1% rule every LLM turn |
| `src/shared/skill-index-builder.ts` | 39 | ✅ shared builder (compact + enforcement formats, chains_to, memory_tags) |
| `src/shared/skill-index-builder.test.ts` | — | ✅ 8 tests |
| `src/features/opencode-skill-loader/types.ts` | — | ✅ chains_to + memory_tags in SkillMetadata + LoadedSkill |
| `src/features/opencode-skill-loader/loaded-skill-from-path.ts` | — | ✅ passes chainedTo + memoryTags through |

**PRs open upstream**: #2256 (skill-manage), #2254 (context-gc)

**Phase 1 architecture decisions** (all resolved, implemented as designed):
- Scope exposure: `"project" | "user"` only
- Name regex: `^[a-z0-9]+(-[a-z0-9]+)*$`
- Write targets: `.opencode/skills/` (project), `~/.config/opencode/skills/` (user)
- Security: hard-block secrets, warn on exec patterns
- Cache: `clearSkillCache()` + `clearSkillToolCaches()` after every mutation
- EXPLORATION_AGENT_DENYLIST: `skill_manage` blocked from read-only agents

---

## Core Design Principles (Vision)

These guide every implementation decision:

1. **Skills + Memory = Skills that remember** — A skill for "debugging TypeScript" stores outcomes in omo-memory. Next invocation, it checks its own history before starting. Infrastructure: `memory_tags` frontmatter + Phase 2.2 usage tracker. The agent-level behavior: *skill begins by querying `omo-memory recall --tags <skill-memory-tags>` to surface past solutions, then acts with that context.*

2. **Many blocks** — Each skill is small and focused. Power comes from composition, not monolithic skills. Builtin skills must be chainable. A `git-master` skill should not also do code review — that's a separate skill that `git-master` chains to via `chains_to`. Design constraint: if a skill does more than one thing, split it.

3. **Context pollution avoidance** — Worker agents (hephaestus, explore, librarian) see only their task — no session history, no full context. Controller (Nous/Sisyphus) maintains state. Two mechanisms: (a) subagent delegation isolates context already; (b) boomerang pattern compresses skill execution to a summary outcome, written to memory — agent sees "Used docker-ops. Result: Modified docker-compose.yml" not 15 tool calls.

4. **Enforcement over suggestion** — Skills injected every turn (system-transform), not just at compaction. 1% rule as mandate. The infrastructure enforces, the agent doesn't need willpower.

---

## Phase 2 — COMPLETE ✅

### 2.1 Structured Subdirectories (LOW effort) ✅

Adopt hermes-agent convention:
```
my-skill/
├── SKILL.md
├── references/    ← additional docs, API specs
├── templates/     ← code templates, config examples
├── scripts/       ← executable helpers
└── assets/        ← images, data files
```

**What's needed:**
- Extend `skill` tool with `file` param: `skill(name="my-skill", file="references/api.md")`
- Update `skill-content.ts` to discover and list subdirectory files
- Note: `skill-directory-loader.ts` already scans depth-2 and detects SKILL.md — partial support exists

### 2.2 Skill Usage Tracking (MEDIUM) ✅

Hook into `skill` tool execution via `tool.execute.after` event. Log to brain: skill name, context, session, outcome.

Enables:
- "You solved 5 Docker problems without a Docker skill — create one?"
- Outcome data feeds `memory_tags` integration (Phase 3.3)

**Wire-in**: `src/hooks/skill-usage-tracker/` — adopt **#2162 subscription pattern**: `subscriptions: ["tool.execute.after"]`

**Boomerang pattern** (from pi-boomerang): instead of just logging "skill X was used", generate a heuristic summary of what the skill actually did by parsing tool calls made during execution (read/edit/bash). Write this as the outcome record under `memory_tags`. Agent sees "Used docker-ops. Result: Modified docker-compose.yml, created .env.example" — not 15 intermediate tool calls. Keeps context clean, outcome rich.

### 2.3 Auto-Suggest from Task Reflection (MEDIUM) ✅

Post-task hook via `session.idle` event.
Trigger: 5+ tool calls AND errors overcome AND no matching skill → offer `skill_manage create`.

**Warning (SoK paper)**: Self-generated skills degrade performance by 1.3pp on average. Human gate is mandatory. Never auto-create — always offer and wait for approval.

**Wire-in**: `src/hooks/task-reflection-suggester/` — adopt **#2162 subscription pattern**: `subscriptions: ["session.idle"]`

---

## Phase 3 — COMPLETE ✅ — Session Injection + Frontmatter Extensions

Core insight from superpowers research: enforcement > suggestion. Skills must be present at every turn, not just at compaction. The infrastructure already exists in our fork as a stub.

### 3.1 Session-Start Skill Injection (LOW effort — unlock everything else)

**Entry point**: `src/plugin/system-transform.ts` — 6-line stub, already registered in `plugin-interface.ts` under `experimental.chat.system.transform`.

**Type signature** (OpenCode upstream):
```typescript
"experimental.chat.system.transform"?: (
  input: { sessionID?: string; model: Model },
  output: { system: string[] },
) => Promise<void>
```

**Fires**: Every LLM turn (not just session start — superpowers uses this to prevent agent drift).

**Implementation pattern**:
```typescript
export function createSystemTransformHandler() {
  return async (_input: { sessionID?: string }, output: { system: string[] }) => {
    const skillIndex = await buildSkillIndex()  // reuse compaction-skill-injector logic
    if (skillIndex) output.system.push(skillIndex)
  }
}
```

**Open question**: Cache by sessionID (cost reduction for long Nous sessions) vs. no cache (superpowers approach — prevents drift). Decide after first implementation + token measurement.

### 3.2 `chains_to` Frontmatter (LOW effort)

Machine-readable skill workflow sequencing. Better than superpowers' prose-only Terminal States.

**Format**:
```yaml
---
name: brainstorming
description: Use before any creative work
chains_to: [writing-plans]
---
```

**What it does**: Skill loader reads `chains_to`, includes it in skill index. Agent sees: `brainstorming → chains to: writing-plans`. No auto-invoke — instructional only.

**Why frontmatter over prose**: Machine-readable for BOC injection, skill graph visualization, future tooling. Superpowers does it in prose; we formalize it.

**Implementation**: Extend `SkillInfo` type + `skill-directory-loader.ts` frontmatter parsing + skill index builder. Combine with `memory_tags` parsing in same PR.

### 3.3 `memory_tags` Frontmatter (MEDIUM effort)

The bridge between omo-memory and the skill system. Our unique contribution — no upstream equivalent.

**Format**:
```yaml
---
name: docker-ops
description: Docker and container operations
memory_tags: [docker, container, compose, dockerfile]
---
```

**Bidirectional integration**:

*Memory → Skill (discovery)*: When `brain/omo-memory bootstrap` surfaces memories tagged `docker`, skill index highlights `docker-ops` as relevant. Agent gets: "Active memory context: docker. Relevant skill: docker-ops."

*Skill → Memory (outcome capture)*: After skill invocation, usage tracker (Phase 2.2) logs outcome to omo-memory tagged with the skill's `memory_tags`. Skills accumulate history.

**Integration with context-gc**: `feat/context-gc` has `recall-hint-injector.ts` — when context-gc moves content to WARM/COLD tier, it can check if any skill's `memory_tags` match and surface that skill. Deferred until both branches merge.

**Implementation scope**:
1. Extend `SkillInfo` + frontmatter parsing (same PR as `chains_to`)
2. `omo-memory bootstrap` CLI: cross-reference surfaced memory tags with skill `memory_tags`
3. Usage tracker (Phase 2.2 prerequisite): after invocation, write outcome to omo-memory
4. context-gc integration: deferred

### 3.4 1% Rule Enforcement Text (TRIVIAL — bundle with 3.1)

Add mandate language to system transform output. Upgrades `categorySkillReminder` from reactive (fires after 3 tools) to proactive (every turn).

Adapted from superpowers:
```
If there is even a 1% chance a skill applies to what you are doing,
you MUST invoke it. This is not optional. Not negotiable.
Before any delegation, before any complex task — check skills first.
```

### 3.5 `#2162` Subscription Pattern (LOW — apply as we write new hooks)

All new hooks declare `subscriptions: string[]` to reduce hot-path dispatch overhead.
Apply to: `skill-usage-tracker` (2.2), `task-reflection-suggester` (2.3).
Consider retrofitting `compaction-skill-injector` + `category-skill-reminder` when #2162 merges upstream.

---

## Implementation Order

```
3.1 + 3.4  system-transform stub → real implementation + 1% rule text    ← START HERE
    ↓
3.2        chains_to frontmatter (combine with 3.3 in same PR)
3.3        memory_tags frontmatter
    ↓
2.1        structured subdirectories (file param on skill tool)
    ↓
2.2 + 3.5  skill usage tracking + subscription pattern adoption
    ↓
2.3 + 3.3  auto-suggest from reflection + memory_tags outcome capture
```

---

## Risk Register

| ID | Risk | Severity | Mitigation |
|----|------|----------|------------|
| R1 | System transform fires every turn — token cost | Medium | Session-ID cache option; compact index only (no full content) |
| R2 | AI slop factory (skills self-generated) | High | Human gate mandatory; auto-suggest only, never auto-create |
| R3 | memory_tags couples omo-memory to fork | Medium | Optional field; bootstrap enhancement is purely additive |
| R4 | context-gc + skill branches diverge before merge | Medium | Integration points as adapters; don't hard-couple pre-merge |
| R5 | chains_to creates rigid workflows agents ignore | Low | Instructional only; prose in skill body reinforces it |
| R6 | #2162 subscription pattern not merged upstream | Low | Simple pattern, easy to implement manually in fork |
| R7 | Skill shadowing (silent loss) | Medium | Conflict detection warning already in Phase 1 |
| R8 | Path traversal via skill name | High | Name regex enforced before any fs operation (Phase 1) |

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| chains_to format | YAML frontmatter | Machine-readable; superpowers proves prose works but isn't inspectable |
| memory_tags direction | Bidirectional | One-way is weak; bidirectionality creates the learning loop |
| 1% rule enforcement | System transform, every turn | Only approach that works; prompts in skill body alone aren't enough |
| context-gc integration | Adapter pattern, deferred | Don't hard-couple two branches pre-merge |
| system-transform caching | TBD post-measurement | Superpowers: no cache (prevent drift). Our case: long sessions make cost real |
| Phase order | 3.1 first | System transform is the unlock — enforcement before features |

---

---

## Phase 4 — COMPLETE ✅ — Lean Skill Injection (supersedes Phase 3.1 system-transform)

**Problem**: `system-transform` injects skill index on every LLM API call (~300 tokens × every tool call). Community-rejected. Violates "avoid context pollution" design pillar. For a 50-call session: 15,000 wasted tokens.

**Root cause**: Misread of superpowers pattern. Superpowers injects a compact meta-skill (~200 tokens, 1% rule + index) ONCE at session start, not every turn. Full skill content is on-demand via the `skill` tool. We injected every turn.

### Research Findings (2026-03-03)

| Source | Finding |
|--------|---------|
| obra/superpowers | Injects once at session start, NOT every turn. Target system prompt <1000 tokens additional. |
| Community standard | Compact index once + on-demand full content via skill tool. |
| Roo Code / Agno | "Retrieval-gated" discovery — inject minimal index, load full on demand. |
| Metis pre-analysis | Critical check: verify AGENTS.md injection is NOT already duplicating skill index before changing anything. |

### 4.1 — Architectural constraint discovered (post-Momus verification)

`chat.message` output has NO `system` field — `output.system[]` only exists on `experimental.chat.system.transform`. Creating a new `chat.message` hook for skill index injection is architecturally impossible without modifying the OpenCode plugin API.

**Correct approach**: Keep `system-transform`, add session-scoped deduplication. ~5 line change.

### 4.2 — Add session dedup to system-transform [PR #1]

**Change only**: `src/plugin/system-transform.ts`

```typescript
export function createSystemTransformHandler(skills: LoadedSkill[]): (
  input: { sessionID: string },
  output: { system: string[] },
) => Promise<void> {
  const injectedSessions = new Set<string>()   // ← ADD

  return async (input, output): Promise<void> => {
    if (injectedSessions.has(input.sessionID)) return  // ← ADD: skip if already injected
    injectedSessions.add(input.sessionID)               // ← ADD: mark as injected

    try {
      const index = buildSkillIndex(skills, "enforcement")
      output.system.push(index)
      log(`[${HANDLER_NAME}] Injected skill index`, { count: skills.length })
    } catch (err) {
      log(`[${HANDLER_NAME}] Failed to inject skill index`, { error: String(err) })
    }
  }
}
```

**Why this is correct**:
- `experimental.chat.system.transform` is the only hook with `output.system`
- Dedup Set scoped to handler closure — survives process lifetime, safe (sessionIDs are UUIDs)
- `compaction-skill-injector` re-injects after compaction independently — no change needed
- Minimal diff: 3 lines added, 0 files deleted, 0 new hooks, 0 schema changes

**What stays unchanged**: everything. No new hooks, no schema changes, `skill-index-builder.ts` untouched.

**Token budget**: ~300 tokens once per session. For 50-call session: 15,000 → 300 tokens (50× reduction).

**Acceptance criteria**:
```bash
# Skill index injected only once per session (log shows 1 injection, not 50)
grep "system-transform.*Injected" /tmp/oh-my-opencode.log | wc -l
# → 1 per session (was: 1 per tool call)

# Compaction still re-injects via compaction-skill-injector
grep "compaction-skill-injector.*Injecting" /tmp/oh-my-opencode.log
# → present after compaction

bun run build  # exit 0
bun test       # all pass
```

---

## Phase 5 — Phase 5.1 COMPLETE ✅ | Phase 5.2 DEFERRED — Boomerang (Skill Outcome Memory)

**Goal**: When agent uses a skill, track what tool calls happened during execution, compress to L1 outcome summary, write to omo-memory. Future bootstrap queries surface "used git-master: Edit(src/auth.ts), Bash(git commit)" not just "git-master used".

### What boomerang is NOT

Full subagent boomerang (Roo Code style): controller throws task to subagent, subagent executes, returns summary, controller context never sees intermediate tool calls. That requires `subtask: true` + spawning Hephaestus per skill invocation. **Deferred to Phase 5.2.**

### What boomerang IS (Phase 5.1 MVP)

Same-session heuristic window tracking. Agent loads skill → we open a window → collect tool calls → close on natural boundary → write L1 summary to memory.

### Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Window start | `skill` tool.execute.after | callID-correlated, deterministic |
| Window end | Next `skill()` call OR `session.idle` (deduped) | C+F hybrid — handles both single/multi-skill sessions |
| Safety flush | `session.deleted` | Catches unclosed windows on crash/close |
| Context reset | `session.compacted` | Flush + reset — compaction summarizes context, old window is stale |
| Data captured | L1: tool name + target | Deterministic, no LLM needed, always available |
| Max window size | 30 tool calls | Prevents memory bloat |
| Hook location | New `skill-boomerang` hook (NOT expanding skill-usage-tracker) | SRP — separate responsibility |
| Memory backend | `NOUS_MEMORY_CLI` env var — no-op if unset | Upstream-compatible: Nous sets it, community doesn't need to |
| Idempotency key | `sessionID + skillName + windowStart` | Prevents duplicate writes on multiple session.idle events |
| Multi-skill overlap | Rotate: flush previous window when new skill invoked | Simple, deterministic |

### 5.1 — Boomerang MVP [PR #2]

New hook `src/hooks/skill-boomerang/`:

```
src/hooks/skill-boomerang/
├── hook.ts          # window management + event handling (~150 LOC)
├── window-state.ts  # SkillWindow type + L1Capture type (~30 LOC)
├── target-extractor.ts  # extract file path / command from tool output title (~40 LOC)
├── memory-writer.ts # NOUS_MEMORY_CLI spawn, fire-and-forget (~40 LOC)
├── index.ts         # barrel export
└── hook.test.ts     # given/when/then tests
```

**Types**:
```typescript
// window-state.ts
export interface L1Capture { tool: string; target: string }
export interface SkillWindow {
  skillName: string
  memoryTags: string[]
  callID: string
  windowStart: number
  toolCalls: L1Capture[]
}
```

**Target extraction** (deterministic, from `output.title` or known patterns):
- `edit` / `write` / `read` → file path
- `bash` → first 60 chars of command from args
- `grep` / `glob` → pattern value
- others → tool name only

**Window lifecycle events**:
- `tool.execute.before` for `skill` → cache `callID → skillName + memoryTags` in pending Map
- `tool.execute.after` for `skill` → open window (or rotate: flush previous, open new)
- `tool.execute.after` for any other tool → append L1Capture to active window (if open, max 30)
- `event(session.idle)` → flush active window, dedup via idempotency Set
- `event(session.deleted)` → flush + cleanup session state
- `event(session.compacted)` → flush + reset (context summarized, window stale)

**Memory write** (`src/hooks/skill-boomerang/memory-writer.ts`):
```typescript
// NOUS_MEMORY_CLI env var — configurable, no-op if absent
const CLI = process.env.NOUS_MEMORY_CLI
if (!CLI) return  // upstream-compatible no-op

const content = `Skill "${skillName}" used. Tools: ${toolCalls.map(c => `${c.tool}(${c.target})`).join(", ")}`
const tags = ["skill-boomerang", skillName, ...memoryTags].join(",")
spawn(CLI, ["capture", "--type", "observation", "--scope", "skill-usage", "--tags", tags, content],
  { detached: true, stdio: "ignore" }).unref()
```

**Tests** (`hook.test.ts`, given/when/then):
- `#given a skill is invoked / #when subsequent tools fire / #then window captures them (max 30)`
- `#given a second skill is invoked / #when previous window was open / #then previous is flushed first`
- `#given session.idle fires twice / #when same window / #then only one memory write (dedup)`
- `#given session.deleted fires / #when window was open / #then flush and cleanup`
- `#given NOUS_MEMORY_CLI is unset / #when window flushes / #then no spawn, no error`

**Acceptance criteria**:
```bash
# Set env var and use a skill in a session, wait for session.idle:
NOUS_MEMORY_CLI=/workspace/brain/omo-memory brain/omo-memory recall --type observation --tags "skill-boomerang" --limit 3
# Assert: content includes "Tools: Edit(...)" or "Tools: Bash(...)" — not just "Skill X used"

bun run build  # exit 0
bun test       # all pass including hook.test.ts
```

**Register in**: `src/plugin/hooks/create-skill-hooks.ts` + `src/config/schema/hooks.ts`.

### 5.2 — Boomerang Full (deferred)

- L2 capture: tool + target + outcome (success/fail/error message)
- LLM-generated narrative summary (async background task, configurable model)
- Auto-query before skill load: `skill(name="X")` pre-populates context with past outcomes
- True subagent boomerang: `subtask: true` in skill frontmatter → spawns Hephaestus → controller gets summary only
- Upstream-compatible memory interface (not env-var based)

---

## Phase 4+5 Implementation Order

```
4.1  ast_grep verify no duplicate injection                          (~10 min, no code change)
  ↓
4.2  Replace system-transform → first-message injection hook         [PR #1, feat/skill-manage]
  ↓
5.1  Boomerang MVP — skill-boomerang hook                            [PR #2, feat/skill-manage]
  ↓
5.2  Boomerang Full                                                   [deferred]
```

### AI Agent Failure Prevention (from Metis)

1. **DO NOT delete `skill-index-builder.ts`** — only change WHERE it's called, not the builder itself
2. **DO NOT use `session.created`** for injection — subagent sessions may not emit it; use `chat.message` first-message gate
3. **DO NOT write memory synchronously in hook chain** — always fire-and-forget (detached spawn)
4. **DO NOT expand skill-usage-tracker** — new `skill-boomerang` hook only
5. **DO NOT hardcode omo-memory path** — use `NOUS_MEMORY_CLI` env var
6. **DO handle session.idle dedup** — multiple idles per session are normal; idempotency Set is mandatory

---

## Phase 6 — Real-World Skills (Nous-Native)

**Status**: COMPLETE ✅ — 2026-03-03

First real-world usage cycle complete. Skills created and committed to `/workspace/.opencode/skills/`:

| Skill | Covers | Status |
|-------|--------|--------|
| `nous-ops` | Plugin build, container restart, rebuild signal (both paths) | ✅ updated |
| `brain-memory` | omo-memory CLI patterns, tool-first gate, capture/recall/KV, decay strategy | ✅ new |
| `nous-github` | Hard constraints (never post), fork policy, PR workflow, Gitea | ✅ new |
| `skill-author` | Skill format, content principles, when to create vs let decay | ✅ new |
| `delegation-patterns` | Category+skill selection, 6-section prompt, session_id continuity | ✅ new |

**Committed**: `6bb6fe3` in workspace repo, pushed to Gitea (`git@10.10.100.77:2222/limax/nous.git` main).

---

## Changelog

- 2026-03-03 (5): Phase 4 + 5.1 verified live. system-transform once-per-session confirmed (log: 1 injection/session). compaction-skill-injector confirmed (fired twice, count=6). skill-boomerang L1 confirmed (observation in omo-memory). category-skill-reminder confirmed (injected into 4th tool call). Phase 5.2 deferred pending L1 data validation. Real-world skills created: brain-memory, nous-github, skill-author, delegation-patterns, nous-ops updated. Committed + pushed to Gitea. Old brain repo history preserved under `pre-migration` tag.
- 2026-03-03 (4): Added Phase 4 (lean injection) + Phase 5 (boomerang). Driven by community rejection of system-transform every-turn injection. Research: superpowers injects once not every turn; pi-boomerang = subagent delegation + L1 capture. Metis pre-analysis surfaced 8 critical decisions. Post-verification correction: chat.message has no output.system field — correct fix is session-dedup in system-transform.ts (3 lines), not new hook. Momus reviewed (blocked by bootstrap protocol × 3, verified manually instead).
- 2026-03-03 (3): ALL PHASES COMPLETE. Phase 2.1 (skill `file` param + subdirectory discovery), 2.2 (skill-usage-tracker hook), 2.3 (task-reflection-suggester hook), 3.3 Python CLI (omo-memory bootstrap skill cross-reference via memory_tags). Delegation bug fixed: `getAgentDisplayName()` applied on all agent launch/resume/sync paths in manager.ts + sync-executor.ts. 6 commits pushed to feat/skill-manage.
- 2026-03-03 (2): Status update. Phase 3.1 (system-transform), 3.2 (chains_to), 3.3 TypeScript side (memory_tags parsing + index display) all complete. Added Core Design Principles section capturing: memory-backed skills agent behavior ("skill reads own history"), many-blocks composition constraint, context pollution avoidance (Controller/Worker isolation + boomerang), enforcement-over-suggestion.
- 2026-03-03: Full rewrite. Codebase audit confirmed Phase 1 complete. Found system-transform stub (6 LOC, already registered) as Phase 3.1 entry point. Added Phase 3 from superpowers research, OMC PR analysis (#2162, #2164, #2245, #2050, #2048, #10542, #1397), context-gc branch audit. Defined memory_tags bidirectionality and chains_to frontmatter. Implementation order: 3.1 → 3.4 → 3.2+3.3 → 2.1 → 2.2+3.5 → 2.3.
- 2026-03-02: Full rewrite of Phase 1 implementation plan. Momus reviewed. skill_manage Phase 1 spec finalized.
- 2026-02-26: Initial plan created.
