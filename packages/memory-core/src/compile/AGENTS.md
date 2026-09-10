# memory-core/src/compile — Committed Memory Compilation

## OVERVIEW

Projects committed memory files into deterministic system-prompt blocks, preserving persona/identity sections, external paths, metadata, and revision-aware cache behavior. Distinct domain (score 8): the only code that turns memory into prompt text. Parent: [`packages/memory-core/AGENTS.md`](../../AGENTS.md).

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Public compile entrypoints | `index.ts`, `compile.ts` |
| Projection rendering | `render.ts` |
| Template/revision cache | `cache.ts` |
| Sentinel helpers | `sentinels.ts` |
| Contract coverage | `*.test.ts` and golden fixtures |

## CONVENTIONS

- `compileMemoryBlock()` resolves `HEAD`; `compileMemoryBlockAtRevision()` accepts an explicit revision and reads through `GitMemoryRepo`.
- System Markdown is sorted by repository-relative path before rendering, so output is deterministic.
- Cache identity is `hashMemoryTemplate(template):agentId` with the revision (or `no-head`) as the variant; the hash is salted with `MEMORY_TEMPLATE_STRUCTURE_VERSION`, so a projection-shape change must bump that constant.
- The cache stores the in-flight promise, and a rejected compile evicts its own entry - a failure never poisons later reads.
- Memory frontmatter is parsed before a file enters the projection.

## ANTI-PATTERNS

- Do not read uncommitted worktree content as compiled memory.
- Do not change sentinel/projection markers without updating the consumers that parse them.
- Do not introduce adapter-specific prompt text into this harness-neutral compiler.

## QA

```bash
bun test packages/memory-core/src/compile/
```

Golden fixtures in `fixtures/` pin the rendered projection; a diff there is a
prompt-contract change, not a formatting detail.
