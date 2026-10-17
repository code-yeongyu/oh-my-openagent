# src/hooks/rules-injector/ — Conditional Rules Injection

**Generated:** 2026-05-15

## OVERVIEW

~40 files (~3.2k LOC incl. tests). The `rulesInjectorHook` — Tool Guard Tier hook that auto-injects AGENTS.md (and similar rule files) into context when a file in a directory is read, written, or edited. Proximity-based: closest rule file to the target path wins. Scanner/parser/matcher/distance primitives are re-exported from `@oh-my-opencode/rules-engine`.

## HOW IT WORKS

```
tool.execute.before (read/write/edit/multiedit)
  → Extract file path from tool args
  → Find rule files near that path (finder.ts)
  → Already injected this session? (cache.ts)
  → Register rule content with contextCollector (source: rules-injector,
    priority: critical) so it reaches the model pre-decision via
    experimental.chat.messages.transform
tool.execute.after (fallback)
  → Extract file path from tool output
  → Same discovery; appends any not-yet-injected rules to tool output
```

Pre-execution registration is the primary path (issue #2568): rules must be
available before write/edit decisions, and must survive tool-output
truncation/replacement. The shared session cache deduplicates between both
paths.

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
