# src/hooks/rules-injector/ — Conditional Rules Injection

**Generated:** 2026-05-15

## OVERVIEW

~40 files (~3.2k LOC incl. tests). The `rulesInjectorHook` — Tool Guard Tier hook that auto-injects AGENTS.md (and similar rule files) into context when a file in a directory is read, written, or edited. Proximity-based: closest rule file to the target path wins. Scanner/parser/matcher/distance primitives are re-exported from `@oh-my-opencode/rules-engine`.

## HOW IT WORKS

```
tool.execute.after (read/write/edit/multiedit, apply_patch)
  → Extract file path(s) from tool output (apply_patch: every added, updated or moved-to file)
  → Find rule files near that path (finder.ts)
  → Already injected this session? (cache.ts)
  → Inject rule content into tool output (injector.ts)
```

## TRACKED TOOLS

`["read", "write", "edit", "multiedit"]` plus `apply_patch` — triggers only on file manipulation tools. apply_patch paths come from its result `metadata.files`, else from the patch's `*** Add File:` / `*** Update File:` / `*** Move to:` headers; deleted files are skipped.

## KEY FILES

| File | Purpose |
|------|---------|
| `hook.ts` | `createRulesInjectorHook()` — wires cache + injector, handles tool events |
| `injector.ts` | `createRuleInjectionProcessor()` — orchestrates find → cache → inject |
| `finder.ts` | `findRuleFiles()` + `calculateDistance()` — locate AGENTS.md near target path |
| `rule-file-finder.ts` | Walk directory tree to find AGENTS.md / .rules files |
| `rule-file-scanner.ts` | Scan for rule files in a directory |
| `matcher.ts` | Match file paths against rule file scope |
| `rule-distance.ts` | Calculate path distance between file and rule file |
| `project-root-finder.ts` | Find project root (stops at .git, package.json) |
| `output-path.ts` | Extract file paths from tool output text |
| `apply-patch-paths.ts` | Files an apply_patch call left in place (metadata first, patch headers as fallback) |
| `cache.ts` | `createSessionCacheStore()` — per-session injection dedup |
| `storage.ts` | Persist injected paths across tool calls |
| `parser.ts` | Parse rule file content |
| `constants.ts` | Rule file names: `AGENTS.md`, `.rules`, `CLAUDE.md` |
| `types.ts` | `RuleFile`, `InjectionResult`, `RuleFileScope` |

## RULE FILE DISCOVERY

Priority (closest → farthest from target file):
1. Same directory as target file
2. Parent directories up to project root
3. Project root itself

Same-distance tie: all injected. Per-session dedup prevents re-injection.

## TRUNCATION

Uses `DynamicTruncator` — adapts injection size based on model context window (1M context models get full content, smaller models get truncated summaries).
