# memory-core/src/tools — Memory Mutation Tools

## OVERVIEW

Implements validated single-file and multi-file memory mutations, patch parsing, typed tool errors, commit metadata, and soul/notice integration. Distinct domain (score 8): the only sanctioned write entry point into the memory repository. Parent: [`packages/memory-core/AGENTS.md`](../../AGENTS.md).

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Command dispatch and file operations | `memory.ts` |
| Multi-file patch entry | `memory-apply-patch.ts` |
| Patch grammar/application | `patch-parser.ts`, `patch-apply.ts` |
| Atomic commit boundary | `commit-write.ts` |
| Error contract | `tool-errors.ts` |
| Public barrel | `index.ts` |

## CONVENTIONS

- `MemoryCommand` is `create`, `str_replace`, `insert`, `delete`, `rename`, `update_description`, and `apply_patch`; each validates repository-relative paths and frontmatter before mutation.
- A successful run returns `MemoryToolCommit` (`sha`, `subject`, `affectedPaths`) for the notice channel; keep that metadata populated when adding a command.
- Writes use the memory-write lock and `GitMemoryRepo`, then commit only affected paths and return commit metadata.
- Patch parsing and application are separate from commit publication so malformed patches cannot partially commit.
- Provenance and post-commit notice data remain typed values rather than ad hoc strings.

## ANTI-PATTERNS

- Do not edit memory Markdown directly from an adapter.
- Do not mutate a `read_only` file, dirty repository, or path outside the validated memory root.
- Do not swallow git, lock, parse, or commit errors or turn a partial patch into success.

## QA

```bash
bun test packages/memory-core/src/tools/
```

Every command path ends in a real commit against a temp repository; assert the
returned commit metadata, not just the message string.
