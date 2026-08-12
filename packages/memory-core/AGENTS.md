# memory-core - Harness-Neutral Agent Memory Engine

## OVERVIEW

`@oh-my-opencode/memory-core` owns the shared memory domain used by harness
adapters: a git-backed markdown MemFS, atomic memory tools, prompt compilation,
reflection scheduling, transcript search, synchronization, and seed content.
The public API is the barrel at `src/index.ts`.

## ANATOMY

| Directory | Responsibility |
|-----------|----------------|
| `src/git/` | Git command boundary, clean-tree checks, commits, merges, remotes, and typed git errors. |
| `src/identity/` | Memory identity resolution and the `OMO_MEMORY_HOME` directory layout. |
| `src/locks/` | Cross-process locks for memory writes, reflection scheduling, and transcript state. |
| `src/memfs/` | Memory-path validation, markdown frontmatter parsing, and hook-script installation. |
| `src/tools/` | `memory` and `memory_apply_patch` operations, patch parsing, typed tool errors, and auto-commit behavior. |
| `src/journal/` | Per-conversation transcript cursors, reflection snapshots, and durable journal state. |
| `src/reflection/` | Trigger evaluation, run reservation, worktree execution, completion validation, and merge outcomes. |
| `src/compile/` | Compile committed memory revisions into marked system-prompt blocks and cache them by template hash. |
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
- **Keep reflection transitions deterministic.** Manual triggers outrank
  compaction, which outranks step-count triggers. Only one active run and one
  merged pending reservation may exist.
- **Keep locks domain-specific.** Use `memory-write`,
  `reflection-scheduler`, or the transcript-specific lock. Do not replace them
  with one global lock or add timing-based tests.
- **Redact before external synchronization.** Remote mirror output must pass
  through the sync redaction layer; never copy secret-bearing raw logs or
  configuration into committed memory.

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

## CONSUMERS

Harness adapters provide identity, lifecycle events, tool registration, and
sync orchestration. The Senpi adapter lives under
`packages/omo-senpi/src/components/memory/`; keep adapter-specific behavior
there rather than importing it back into this package.

## QA

```bash
bun test packages/memory-core/src/
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
