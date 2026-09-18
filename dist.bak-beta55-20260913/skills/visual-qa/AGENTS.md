# visual-qa — Bundled Visual-Evidence CLI

**Generated:** 2026-08-24 (f3642fcda)

## OVERVIEW

The visual-QA skill's executable core: a zero-dependency Node CLI that produces machine evidence (`image-diff`, `tui-check`) plus the TypeScript sources it is bundled from. Earned this file: the only shared skill shipping a built bundle whose runtime and development sources must be kept in lockstep.

## STRUCTURE

```
visual-qa/
├── SKILL.md                      # reviewer workflow (dual oracle, evidence gates) — the prose contract
├── references/agent-browser-setup.md
└── scripts/
    ├── visual-qa.mjs             # SHIPPED RUNTIME: bun-build bundle of cli.ts (+ embedded modules)
    ├── cli.ts                    # development source; dispatches image-diff / tui-check
    ├── image-diff.ts             # diffImages — 8x8 grid cells, hotspots, rounded metrics
    ├── tui-grid.ts               # checkTui — column overflow + border alignment verdicts
    ├── east-asian-width.ts       # charWidth / stringWidth — CJK-aware width math
    ├── ansi.ts                   # ANSI escape stripping (width must be escape-aware)
    ├── png-decode.ts / png-crc.ts / png-synth.ts   # stdlib PNG codec (no deps)
    ├── types.ts
    └── *.test.ts                 # co-located bun tests for every module above
```

## BUNDLE/SOURCE DUALITY

`visual-qa.mjs` is the artifact the skill's commands invoke (`node "$SKILL_DIR/scripts/visual-qa.mjs" …`); the `.ts` files exist for development and tests only. A behavior fix lands in the TS source AND the bundle is regenerated from `cli.ts` — editing one without the other makes tests and runtime disagree. Never hand-edit the `.mjs`.

## SURFACE

- Commands: `image-diff <reference.png> <actual.png>` and `tui-check <capture.txt> --cols <N>`; JSON verdict output (hotspot cells, overflow lines, wide-char columns, border alignment).
- Module exports: `diffImages`, `checkTui`, `charWidth`/`stringWidth`, ANSI + PNG helpers. `cli.ts` owns `CliError`, `parseColumns`, `run`, `main`.

## CONVENTIONS

- Zero runtime dependencies — PNG decode/synthesis and ANSI handling are hand-rolled in `scripts/`; keep it that way (the bundle must stay require-free apart from `node:` builtins).
- Width is never `String.length`: CJK wide characters and ANSI escapes are accounted for before any column math.
- Tests are co-located `bun test scripts/*.test.ts`, given/when/then style per repo convention.

## ANTI-PATTERNS

- NEVER hand-edit `visual-qa.mjs`; regenerate from source.
- Don't add an npm dependency to make PNG/diff easier — the no-dep bundle is the point.
- Column math that ignores CJK width or ANSI escapes is wrong by construction; `tui-check` exists because text-diff tools get terminal grids wrong.
- Skill-level rule worth repeating for code changes: `tmux capture-pane` is forbidden as a capture mechanism.

## COMMANDS

```bash
# from packages/shared-skills/skills/visual-qa/
node scripts/visual-qa.mjs image-diff <reference.png> <actual.png>
node scripts/visual-qa.mjs tui-check <capture.txt> --cols 80
bun test scripts/*.test.ts
```

- Parent: [`packages/shared-skills/AGENTS.md`](../../AGENTS.md).
