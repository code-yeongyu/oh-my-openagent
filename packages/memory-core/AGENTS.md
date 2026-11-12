# memory-core - Harness-Neutral Agent Memory Engine

## OVERVIEW

`@oh-my-opencode/memory-core` owns the shared memory domain used by harness
adapters: a git-backed markdown MemFS, atomic memory tools, prompt compilation,
reflection scheduling, transcript search, synchronization, and seed content.
The public API is the barrel at `src/index.ts`.

## ANATOMY

| Directory | Responsibility |
|-----------|----------------|
| `src/git/` | Git command boundary, clean-tree checks, commits, merges, remotes, and typed git errors. A stranded git lock is reclaimed only with proven-dead ownership (`repo-lock-sweep.ts`); a kept one surfaces `StrandedGitLockError` with the way out, `inspectStrandedGitLock` / `unlockStrandedGitLock` (`repo-lock-unlock.ts`: refuse on any visible live holder, remove one confirmed lock after a fresh re-check). |
| `src/identity/` | Memory identity resolution and the `OMO_MEMORY_HOME` directory layout. `resolveAutoIdentity(cwd, env, mode, probe?)` is the one entry point for the auto identity; its opt-in `"git"` mode (`git-layout.ts`) maps a linked worktree's cwd onto the main working tree by reading the `.git` pointer, `commondir`, the admin `gitdir` back-pointer and `core.worktree`/`core.bare` (no `git` spawn), and any unreadable, forged or ambiguous layout keeps the path-derived id. |
| `src/locks/` | Cross-process locks for memory writes, reflection scheduling, and transcript state, plus the machine-wide `recall-wake` counting lease (`recall-wake.slot-<n>.lock` per slot, FIFO `recall-wake.tickets/`, default 2 slots, proof-based stale recovery for slots and tickets alike, bounded wait ending in `RecallWakeBusyError`). |
| `src/memfs/` | Memory-path validation, markdown frontmatter parsing, and hook-script installation. |
| `src/tools/` | `memory` and `memory_apply_patch` operations, patch parsing, typed tool errors, and auto-commit behavior. `leaked-arguments.ts` splits an argument that leaked into its sibling (`summary</description>\n<parameter name="file_text">body`) back apart before `runMemoryTool` validates. |
| `src/journal/` | Per-conversation transcript cursors, reflection snapshots, and durable journal state. |
| `src/facts/` | Durable fact pipeline: queue + cursor watermarks, failure backoff/store, payload capping, person routing, recovery, mutation planning. |
| `src/people/` | People-card grammar: parse/serialize, slug rules, reserved slugs, observations. |
| `src/soul/` | Soul-file paths and identity-scoped soul-notice watermark consumption. |
| `src/agreements/` | The working-agreement ledger at `system/agreements.md` (#10780): one line per agreement with `id`/`by`/`n`/`since`/`last`/`status` in a trailing comment, id = sha256 of the normalized text (first 10 hex). `mutate.ts` counts repeat corrections, flags `needs-human` at the threshold, and at the cap evicts only the oldest never-reaffirmed, unflagged agent item (reported as an `AgreementEvent`, named in the facts commit as `Omo-Agreement-Evicted`) or refuses the new one - it never merges distinct rules; `guard.ts` refuses automation edits to `by: human` items; `render.ts` builds the compiled `<agreements>` section; `notice-watermark.ts` announces each newly flagged item once per identity. |
| `src/reflection/` | Trigger evaluation, run reservation, worktree execution, completion validation, merge outcomes, the orphan sweep that reclaims worktrees/branches no live run owns, and the park policy that stops automatic reflection after repeated failures (one half-open probe per interval). |
| `src/compile/` | Compile committed memory revisions into marked system-prompt blocks and cache them by template hash. |
| `src/cleanup/` | The memory cleanup pass (`planMemoryCleanup` / `applyMemoryCleanup` / `renderMemoryCleanupReport`): a dry-run planner over the live content notes that classifies duplicates (identical or paragraph-Jaccard >= 0.9), superseded notes (an explicit `supersedes [[old]]` / `superseded by [[new]]` wikilink declaration, or a dated series whose newer version carries >= 90% of the older's paragraphs), stale notes (the note's own `expires` instant passed, or a `-LIFTED`/`-EXPIRED`/`-RETIRED`/`-SUPERSEDED` file name; age alone is never evidence) and conflicts (`contradicts`/`conflicts with` declarations, or mutual supersession), plus the `system/` token delta against `compile_warn_tokens`. Apply never deletes: an archived note becomes a provenance section in root `ARCHIVE.md` (reason, successor, evidence, original header, the body with its relative links re-resolved for the root), a duplicate's distinctive paragraphs are appended verbatim to the canonical, conflicts are kept and marked with a `conflicts_with` header key, inbound wikilinks and markdown links in every markdown file (`notes/`, `README.md` and the legacy `memory/` layout included) are repointed through `reflection/link-rewrite.ts`, and the whole set lands as one `commitMemoryWrite` (`writer: "human-command"`). `system/persona.md`, `system/human.md`, `system/identity.md` and `system/agreements.md` are held unless `includeLoadBearing`; `read_only` notes and files the scan skipped as unparsable are always held, including when the only write would be a repointed link; the plan carries a content-hash snapshot and apply refuses a repository that moved under it; a second run plans nothing. |
| `src/search/` | Query parsing, transcript providers, and ranked memory/session search. |
| `src/sync/` | Remote mirror synchronization and secret redaction. |
| `src/reminders/` | Reflection and memory-maintenance reminder generation. |
| `src/seeds/` | Default memory blocks and first-run repository seeding. |
| `src/concurrency/` | Subprocess fixtures for lock and multi-writer tests; not a public runtime module. |

## CORE INVARIANTS

- **Stay harness-neutral.** Production code and package dependencies must not
  import Senpi, Pi, OpenCode adapters, or other harness-specific packages.
  `src/harness-neutrality.test.ts` enforces this boundary.
- **Treat the memory repository as transactional state.** Write tools acquire
  the `memory-write` lock, require a clean repository, validate paths, apply one
  operation, and commit only the affected paths. Do not bypass
  `GitMemoryRepo`, lock domains, or the tool entry points.
- **Compile from committed state.** Prompt compilation may target `HEAD` or an
  explicit revision. Uncommitted working-tree content is not authoritative
  memory.
- **Preserve markdown contracts.** Memory files require YAML frontmatter with a
  non-empty `description`; `read_only: "true"` blocks mutation. Keep UTF-8,
  normalized repository-relative paths, and LF output.
- **Frontmatter is strict YAML, one grammar everywhere.** `renderMemoryFile`
  is the only writer: it quotes any scalar that the `yaml` package would not
  read back verbatim and re-parses its own header. The reader decodes quoted
  scalars, keeps non-contract keys (`extra`) so SKILL.md `name`/`version`
  survive edits, and only falls back to the legacy first-colon grammar for
  pre-existing files. `describeFrontmatterViolation` is the shared gate for
  the pre-commit hook rules, `validateCompletion`, and
  `normalizeMemoryFrontmatter` (one-time legacy repair keyed by a marker in
  the common git dir). Never emit an unquoted `description:` by hand.
- **Keep reflection transitions deterministic.** Manual triggers outrank
  compaction, which outranks step-count triggers. Only one active run and one
  merged pending reservation may exist.
- **Keep locks domain-specific.** Use `memory-write`,
  `reflection-scheduler`, or the transcript-specific lock. Do not replace them
  with one global lock or add timing-based tests.
- **Redact before external synchronization.** Remote mirror output must pass
  through the sync redaction layer; never copy secret-bearing raw logs or
  configuration into committed memory.
- **Facts state is durable and fail-closed.** Queue/cursor/consumed writes
  publish atomically (`.tmp` + rename, mode `0o600`) under an identity-scoped
  lock; malformed JSON parses to empty, never blocks. Enqueue/consumed
  watermarks NEVER regress, and ordering follows canonical journal position /
  snapshot boundary — never lexical message-ID comparison.
- **Agreements the person wrote are immutable to automation.** Only the
  adapter's `/agreements` command (`commitMemoryWrite` with `writer:
  "human-command"`) may create, reword, ack, or drop a `by: human` item. The
  memory tools and `memory_apply_patch` refuse such edits
  (`tools/agreements-write-guard.ts`), reflection/dream completion fails on
  any change to `system/agreements.md`, a move or delete included (the check
  diffs with `--no-renames`), and the facts lane only counts them. Automation
  also may not remove a counted agent item (`n > 0`), so a count cannot be
  reset by delete-and-re-add. With `agreements.enabled: false` the existing
  ledger is still projected, so the person's own items stay visible.
- **Behavioral patterns are NEVER stored in people cards.** Card lines are
  limited to the `IDENTITY` / `ATTRIBUTE` / `RELATIONSHIP` / `INSTRUCTION`
  prefixes with bounded metadata.

## PUBLIC SURFACES

- `runMemoryTool()` implements `create`, `str_replace`, `insert`, `delete`,
  `rename`, and `update_description`.
- `runMemoryApplyPatch()` applies multi-file Codex-style patches inside the
  memory repository.
- `GitMemoryRepo` owns repository initialization, clean checks, commits,
  revisions, merge worktrees, and remote detection.
- `evaluateTransitions()`, `reserveTransition()`, and
  `completeTransition()` form the pure reflection state machine.
- `compileMemoryBlock()` and `compileMemoryBlockAtRevision()` render the
  committed memory projection injected into a harness prompt.
- `planMemoryCleanup()`, `applyMemoryCleanup()` and `renderMemoryCleanupReport()`
  form the cleanup pass (`src/cleanup/`, package export `./cleanup`, not the
  root barrel): plan is read-only, apply archives into `ARCHIVE.md` and never
  deletes, the report is what a person reads before `--apply`. The root barrel
  does not re-export it, so an eager harness bundle that imports the barrel
  does not trace `reflection/link-rewrite.ts`.
- `FactsQueue`, `applyFactsBatch()`, `planFactsMutation()`, and
  `consumeSoulNoticeDelta()` drive the facts/soul lifecycle from
  `src/facts/` and `src/soul/`.

## CONSUMERS

Harness adapters provide identity, lifecycle events, tool registration, and
sync orchestration; the Senpi adapter lives in `packages/omo-senpi/src/components/memory/`.
Keep adapter-specific behavior there, never imported back into this package.

## QA

```bash
bun test --timeout 20000 packages/memory-core/src/
bun run --cwd packages/memory-core typecheck
```

For a focused change, run the nearest co-located `*.test.ts` first, then the
package suite. Concurrency tests must await exact state or process events with
bounded timeouts; never add fixed sleeps or retry loops.

## ANTI-PATTERNS

- Importing a harness package into `memory-core`.
- Writing directly to memory markdown without path validation, frontmatter
  parsing, locking, and an atomic git commit.
- Reading the dirty worktree as compiled memory.
- Mutating `read_only` blocks or accepting non-UTF-8 memory files.
- Swallowing git, lock, merge, or reflection failures.
- Testing cross-process behavior with timing luck.
