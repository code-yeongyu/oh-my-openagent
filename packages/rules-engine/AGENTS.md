# rules-engine — Rule Discovery + Matching (Core)

**Generated:** 2026-06-16

## OVERVIEW

`@oh-my-opencode/rules-engine` (renamed from `rules-core`). Harness-neutral TypeScript package that discovers markdown rule files and matches them against target paths. Consumed by the `rules-injector` hook in `omo-opencode`, the `rules` component in `omo-codex`, and `agents-md-core` for AGENTS.md walk-up discovery.

## KEY FILES

| File | Role |
|------|------|
| `src/index.ts` | Barrel: legacy/simple API (`findRuleFiles`, `shouldApplyRule`, `findAgentsMdUp`) |
| `src/engine/index.ts` | Barrel: comprehensive engine API (`createEngine`, `findRuleCandidates`, `matchRule`) |
| `src/finder.ts` | `findRuleFiles()` — walks project + user home directories to collect rule candidates |
| `src/matcher.ts` | `shouldApplyRule()` — picomatch against rule globs/paths with LRU cache |
| `src/agents-md.ts` | `findAgentsMdUp()` — walk-up discovery for `AGENTS.md` from start dir to root |
| `src/engine/engine.ts` | `createEngine()` — static + dynamic loading, session state, formatting, truncation |
| `src/engine/finder.ts` | `findRuleCandidates()` + `findPluginBundledCandidates()` with source filtering |
| `src/engine/matcher.ts` | `matchRule()` with content-hash dedup |
| `src/engine/scanner.ts` | `scanRuleFiles()` — recursive directory scanner with caching |
| `src/engine/formatter.ts` | `formatStaticBlock()` / `formatDynamicBlock()` with per-mode char budgets |
| `src/constants.ts` | Rule sources, extensions, source priority map, project root markers |

## FLOW

Discovery (`finder.ts` / `engine/finder.ts`)
  Walk UP from cwd toward project root
    Scan `.omo/rules`, `.claude/rules`, `.cursor/rules`, `.github/instructions`
    Collect `.md` / `.mdc` files + single-file rules (`copilot-instructions.md`, `CONTEXT.md`)
  Walk user home: `~/.omo/rules`, `~/.opencode/rules`, `~/.claude/rules`
  Plugin bundled: platform-gated rules under `bundled-rules/`

Matching (`matcher.ts` / `engine/matcher.ts`)
  Parse YAML frontmatter (globs, paths, applyTo, alwaysApply)
  Picomatch against target file path (relative + basename)
  Negative globs (`!`) excluded; `alwaysApply: true` bypasses matching

Ordering
  Source priority map (`SOURCE_PRIORITY`) + distance from target file
  Lower priority value = earlier; closest distance wins

## NOTES

- Two APIs: root `src/` (simple functions) and `src/engine/` (stateful engine with truncation budgets). Both consumed in production.
- Default char budgets: static 12K rule / 40K total; dynamic 4K / 10K; post-compact 3.5K / 4K.
- `AGENTS.md` discovery lives here but injection logic is in `agents-md-core`.
- Parent: [`packages/AGENTS.md`](../AGENTS.md)
