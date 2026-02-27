# R0.3 Rehearsal Impact Report (File + Semantic)

- Timestamp (UTC): 2026-02-27T16:35:00Z
- Task: `R0.3 Generate impact report from rehearsal output (file + semantic)`
- Primary inputs:
  - `changes/route-c-bae3bdc2-downstream-preservation/evidence/rehearsal-conflicts.md`
  - `git diff --name-status -M rescue/pre-merge-bae3bdc2...recovery/remerge-20260226 -- "src/**"`
  - `git diff --name-status -M bae3bdc2..aa012f44 -- "src/**"`

## 1) Added / Modified / Deleted Runtime Files

Scope for runtime classification: non-test TypeScript under `src/**`.

### Rehearsal pull-in range
`rescue/pre-merge-bae3bdc2...recovery/remerge-20260226`

- Runtime TS changed (non-test): **823**
- Status breakdown:
  - Added: **560**
  - Modified: **238**
  - Deleted: **18**
  - Renamed: **7**

### Structural risk range
`bae3bdc2..aa012f44`

- Runtime TS changed (non-test): **15**
- Status breakdown:
  - Added: **4**
  - Modified: **11**
  - Deleted: **0**
  - Renamed: **0**

### Runtime-impact hotspots (subsystem grouped)

- **Atlas orchestration hooks** (`src/hooks/atlas/**`)
  - Examples: `atlas-hook.ts`, `event-handler.ts`, `tool-execute-after.ts`, `system-reminder-templates.ts`
  - Impact: continuation injection policy, session event handling, retry path behavior.

- **Todo continuation enforcement** (`src/hooks/todo-continuation-enforcer*`)
  - Rehearsal diff shows split from monolith file into directory-based module set plus legacy deletion.
  - Impact: abort detection, idle-event gating, countdown + continuation trigger sequencing.

- **Session manager tools** (`src/tools/session-manager/**`)
  - Examples: `storage.ts`, `tools.ts`, `types.ts`, `session-formatter.ts` (rename from `utils.ts`).
  - Impact: session selection/formatting behavior used by session inspection tooling.

- **Runtime fallback subsystem** (`src/hooks/runtime-fallback/**`)
  - Entire hook subsystem added in rehearsal range.
  - Impact: model-fallback trigger, retry/error-classification path, message-update handling.

- **Builtin skills plumbing** (`src/features/builtin-skills/**`)
  - Examples: `skills.ts`, `skills/git-master.ts`, `skills/playwright-cli.ts`.
  - Impact: skill metadata/availability and runtime trigger surfacing for model/tool behavior.

## 2) High-Risk Behavior Paths

This section merges rehearsal literal conflicts + semantic-risk candidates with fresh hotspot scans.

### Reused rehearsal evidence (authoritative)

- Literal merge conflicts: **64** total (`58` content + `6` delete-modify)
- Semantic-risk candidates (both sides changed without literal conflict): **42**

High-risk paths from rehearsal artifact (representative):

- **Atlas / orchestration**
  - `src/hooks/atlas/index.ts`
  - `src/hooks/atlas/index.test.ts`
  - `src/hooks/atlas/atlas-hook.ts` (add/add conflict)
  - `src/hooks/atlas/event-handler.ts` (add/add conflict)

- **Todo continuation**
  - `src/hooks/todo-continuation-enforcer.ts` (delete-modify)
  - `src/hooks/todo-continuation-enforcer/todo-continuation-enforcer.test.ts`

- **Session manager**
  - `src/tools/session-manager/storage.ts`
  - `src/tools/session-manager/tools.ts`
  - `src/tools/session-manager/tools.context.test.ts` (add/add conflict)

- **Skill/runtime-trigger surfaces**
  - `src/features/builtin-skills/skills.ts`
  - `src/tools/skill/tools.test.ts`
  - `src/hooks/keyword-detector/index.test.ts` (semantic-risk list)

### Semantic behavior risks by subsystem

- **Orchestration state transitions (Atlas + Todo)**
  - Risk: duplicate/late continuation injections, abort-state races, background-task suppression mismatches.
  - Evidence from search: continuation state + cooldown logic in `atlas/event-handler.ts`; countdown/recovery guards in `todo-continuation-enforcer.ts`.

- **Session state/data compatibility (Session Manager)**
  - Risk: behavior changes in main-session filtering and formatting due to storage/toolchain refactor and rename.

- **Model fallback runtime behavior**
  - Risk: fallback subsystem introduction changes retry and error-classification semantics at runtime.

- **Skill activation metadata routing**
  - Risk: builtin skill parser + metadata updates can alter downstream skill-trigger behavior and tool policy injection.

## 3) Likely No-Op Differences (Need lower merge priority)

These are likely low runtime impact, but **not** reclassified as runtime-doc-only unless explicit evidence supports it.

- **Documentation-only under src**
  - `src/**/AGENTS.md`: **30** changed files (guidance docs, not runtime code).

- **Test-only and snapshot-only**
  - `src/**/*.test.ts`: **233** changed files in rehearsal range.
  - `src/**/__snapshots__/**`: snapshot delta present (example: `src/cli/__snapshots__/model-fallback.test.ts.snap`).

- **Interpretation note**
  - Test/snapshot churn is likely no-op for production runtime behavior, but can indicate expected behavior drift and must still inform conflict adjudication.

## 4) Command Evidence Snippets Used for Classification

```bash
# Required diff evidence
git diff --name-status -M rescue/pre-merge-bae3bdc2...recovery/remerge-20260226 -- "src/**"
git diff --name-status -M bae3bdc2..aa012f44 -- "src/**"

# Runtime TS counts (rehearsal range)
git diff --name-only rescue/pre-merge-bae3bdc2...recovery/remerge-20260226 -- "src/**/*.ts" ":(exclude)src/**/*.test.ts" | wc -l
# => 823
git diff --name-only --diff-filter=A rescue/pre-merge-bae3bdc2...recovery/remerge-20260226 -- "src/**/*.ts" ":(exclude)src/**/*.test.ts" | wc -l
# => 560
git diff --name-only --diff-filter=M rescue/pre-merge-bae3bdc2...recovery/remerge-20260226 -- "src/**/*.ts" ":(exclude)src/**/*.test.ts" | wc -l
# => 238
git diff --name-only --diff-filter=D rescue/pre-merge-bae3bdc2...recovery/remerge-20260226 -- "src/**/*.ts" ":(exclude)src/**/*.test.ts" | wc -l
# => 18
git diff --name-only --diff-filter=R rescue/pre-merge-bae3bdc2...recovery/remerge-20260226 -- "src/**/*.ts" ":(exclude)src/**/*.test.ts" | wc -l
# => 7

# Low-risk/no-op candidate counts
git diff --name-only rescue/pre-merge-bae3bdc2...recovery/remerge-20260226 -- "src/**/*.test.ts" | wc -l
# => 233
git diff --name-only rescue/pre-merge-bae3bdc2...recovery/remerge-20260226 -- "src/**/AGENTS.md" | wc -l
# => 30
```

Hotspot scan commands (semantic-risk support):

```bash
grep pattern: fallback|retry|resume|inject|override|state|storage|continuation|trigger
path: src/hooks/atlas (matches in atlas-hook.ts, event-handler.ts, tool-execute-after.ts)

ast-grep search: injectContinuation($$$)
path: src/hooks/atlas/*.ts
# => match in src/hooks/atlas/event-handler.ts
```

## 5) Summary for Downstream Tasks (R0.4 / R0.5 input)

- Runtime-impact surface is large and non-empty, concentrated in orchestration/session/continuation/fallback/skills zones.
- Rehearsal conflict artifact remains the source of truth for literal + semantic conflict set (`64` + `42`).
- No-op candidates are mostly `AGENTS.md`, tests, and snapshots; they are lower runtime priority but still useful for equivalence checks.
