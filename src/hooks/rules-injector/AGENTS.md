# src/hooks/rules-injector/ — Conditional Rules Injection

**Generated:** 2026-02-19

## OVERVIEW

19 files (~1604 LOC). The `rulesInjectorHook` — Tool Guard Tier hook that auto-injects AGENTS.md (and similar rule files) into context when a file in a directory is read, written, or edited. Proximity-based: closest rule file to the target path wins.

## HOW IT WORKS

```
tool.execute.after (read/write/edit/multiedit)
  → Extract file path from tool output
  → Find rule files near that path (finder.ts)
  → Already injected this session? (cache.ts)
  → Inject rule content into tool output (injector.ts)
```

## TRACKED TOOLS

`["read", "write", "edit", "multiedit"]` — triggers only on file manipulation tools.

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
