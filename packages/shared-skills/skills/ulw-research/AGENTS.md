# ulw-research — Research Orchestration + report-tools Runtime

## OVERVIEW

`SKILL.md` is the research orchestration contract (team-first saturation, claim graph, convergence, delivery). `scripts/` is the deliverable runtime that contract calls: `report-tools.mjs`, a zero-dependency Node CLI for the deliverable phase (outcome manifest, static and layout gates, bounded repair, format extraction). `references/` holds the edition-neutral deliverable contract and the defect glossary. Earned this file: the only shared skill whose runtime is overlaid into a second, separately authored edition (the senpi native skill) at sync time.

## STRUCTURE

```
ulw-research/
├── SKILL.md                         # shared-edition prose contract (router to the references)
├── references/
│   ├── deliverable-phase.md         # lanes, state, destination defaults, interview, memory episodes, design spec, gates, repair, manifest, command reference
│   ├── report-gates.md              # one row per defect code: severity, integrity, what it detects, how to fix
│   └── latex-report.md
└── scripts/
    ├── report-tools.mjs             # CLI entry + dispatcher (COMMANDS, run, main)
    ├── report-tools-commands.mjs    # one function per subcommand
    ├── cli-support.mjs / entry-guard.mjs   # flags, CliError, exit codes, atomic JSON, symlink-safe entry check
    ├── contracts.mjs                # frozen vocabulary: DEFECT_CODES (severity lives only here), enums, manifest + repair-state validators
    ├── outcome.mjs                  # outcome.json manifest, deliverable state, verify, closing briefing
    ├── repair-tracker.mjs           # bounded repair decisions (attempts, plateau, oscillation, wall clock, integrity codes)
    ├── html-lite.mjs / entities.mjs # HTML tokenizer, selector paths, prose text
    ├── css-lite.mjs / design-spec.mjs      # CSS scanning, palette + lineage parsing, design-spec rendering
    ├── gates-static.mjs + gates-text.mjs / gates-figures.mjs / gates-structure.mjs   # static gates G1-G15
    ├── layout-probe.mjs / gates-layout.mjs # in-page probe source + layout gates L1-L5 over its output
    ├── format-extract.mjs / format-extract-css.mjs   # design-spec draft from a pointed-at HTML or Markdown document
    ├── *.test.ts                    # co-located bun tests, one per module (unshipped)
    └── tests/fixtures/              # good/bad reports, boxes.json, reference docs (unshipped)
```

## SURFACE

`node "$SKILL_DIR/scripts/report-tools.mjs" <command>`: `check`, `layout-probe`, `repair decide`, `outcome init`, `outcome set`, `outcome gate`, `outcome render`, `outcome state`, `outcome verify`, `outcome finish`, `outcome briefing`, `format-extract`, `--help --json`. Exit codes: `0` pass, `1` semantic failure (blockers, a failed verify, a blocked repair), `2` usage or IO. JSON on stdout, one summary line on stderr. Flags per command: `references/deliverable-phase.md` section 10.

## CONVENTIONS

- Zero runtime dependencies: plain ESM `.mjs`, `node:` builtins and sibling imports only, no `Bun.*`. Runs under Node >= 20 or Bun 1.4 (global `fetch` for `format-extract --from-url`).
- Each `.mjs` stays at or under 250 lines; split by responsibility, never by size.
- The CLI never launches a browser. The layout probe is printed as one async expression; the orchestrator evaluates it through the browser skill's owned headless engine and passes the result back with `check --layout`.
- Time is always injected (`--now`, `startedAt`); no module reads the clock inside a decision.
- Tests are co-located given/when/then bun tests; CLI tests spawn `node` with bun removed from `PATH`. Fixtures live only under `scripts/tests/fixtures/`, are depersonalized, and never ship.
- The senpi source dir (`packages/omo-senpi/skills/ulw-research/`) intentionally has no `scripts/`, `references/report-gates.md`, or `references/deliverable-phase.md`: the senpi sync overlays them from here byte-for-byte (`sharedAssets` in `packages/omo-senpi/plugin/scripts/native-skill-sources.mjs`), and both editions' sync suites assert the shipped copies equal these sources.
- References and scripts carry no Hangul (Korean match strings are `\u` escapes) and never three consecutive newlines (the senpi sync normalizes those and would break byte equality).

## ANTI-PATTERNS

- NEVER hand-edit a shipped copy under `packages/omo-senpi/plugin/skills/` or the packaged plugin tree; edit here and re-sync.
- NEVER add a severity override or a caller-supplied severity. The only sanctioned exception is `unsourced_number` following the design spec's `Lineage:` mode.
- Never let a gate or the repair loop silently skip: an unrunnable gate is recorded `not_run`, and an integrity code blocks delivery.
- Never name a browser library in the references or `SKILL.md`; route through the browser skill.
- Never test prose: pin machine-consumed values (CLI JSON, exit codes, extractor output, tracker decisions, defect-code vocabulary) and shipped-copy equality only.

## COMMANDS

```bash
# from the repository root
bun test --timeout 20000 packages/shared-skills/skills/ulw-research/scripts
node packages/shared-skills/skills/ulw-research/scripts/report-tools.mjs --help --json
node packages/omo-senpi/plugin/scripts/sync-skills.mjs && bun test packages/omo-senpi/src/skills-sync.test.ts
```

- Parent: [`packages/shared-skills/AGENTS.md`](../../AGENTS.md).
