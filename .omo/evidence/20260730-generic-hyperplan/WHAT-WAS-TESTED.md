# Generic Hyperplan QA Evidence

## What Was Tested

### OpenCode

Command:

```bash
bash .omo/evidence/20260730-generic-hyperplan/run-opencode-qa.sh
```

Surface:

- Real `opencode debug skill` and `opencode run --format json`.
- Current worktree plugin loaded from `packages/omo-opencode/src/index.ts`.
- Local OpenAI-compatible mock model, with no remote model request.
- Isolated `HOME` and all four `XDG_*` roots.

Behavior:

- OpenCode discovers `hyperplan` with the harness-neutral description.
- A real model turn calls `skill({ name: "hyperplan" })`.
- The tool output contains backend selection, the TraeX reference, and the
  existing OpenCode Team Mode flow.
- The real user database session count does not change.

Additional command:

```bash
bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check
```

This verifies the bundled isolation harness and automatic cleanup.

### TraeX

Command:

```bash
traecli exec --ephemeral --json -C <worktree> \
  "/hyperplan Produce an executable planning consultation only ..."
```

Surface:

- Real TraeX 0.200.19 skill discovery and native collaboration tools.
- Read-only hypothetical planning request.

Behavior:

- TraeX loaded `references/traex.md`.
- It selected native subagent orchestration instead of OpenCode `team_*`.
- It emitted the required banner and todo phases.
- It created five unique reviewer threads and entered a collective wait.

A second run explicitly set:

```bash
-c features.multi_agent_v2.enabled=true
-c features.multi_agent_v2.max_concurrent_threads_per_session=6
```

The second run and a minimal `READY` health probe both reached
`thread.started` / `turn.started` but received no first model token. They were
stopped cleanly. Therefore the complete three-round debate and planner
handoff were not observed in this environment.

### Static And Packaging

Commands:

```bash
diff -ru .agents/skills/hyperplan .opencode/skills/hyperplan
bun test script/package-layout.test.ts
bun pm pack --dry-run --ignore-scripts
bun run typecheck
bun run build
```

The two compatibility trees are byte-identical, all 8 package-layout tests
pass, all four Hyperplan files appear in the package dry run, typecheck passes,
and the complete build passes.

Frontmatter was parsed with the repository's installed `js-yaml`; both copies
have `name: hyperplan` and descriptions under the 1024-character limit.

`script/package-layout-exclusion.test.ts` initially hit `EPERM` while creating
its temporary fixture under `.agents/skills` in the sandboxed
`/private/tmp` worktree. It was rerun outside the outer sandbox, where both
tests and all 7 assertions passed; its fixture was removed.

The root `bun test` run completed with `12497 pass`, `3 skip`, and `38 fail`.
Every Hyperplan keyword, combo, and Team Mode validator test passed. The 38
failures were unrelated environment-sensitive suites: sandbox-denied writes to
the worktree, HOME, and temp directories; process inspection; CLI binary/path
assumptions; and one five-second full-tree scan timeout. The directly relevant
package layout tests were rerun in the required environment and passed.

## What Was Observed

- `opencode-qa-summary.txt`: OpenCode QA PASS.
- `opencode-run.jsonl`: completed `skill` tool call and
  `OPENCODE_HYPERPLAN_SKILL_OK`.
- `opencode-isolation.txt`: real session count `1900 -> 1900`.
- `opencode-common-self-check.txt`: all isolation helper checks PASS.
- `package-layout.txt`: all 8 package-layout tests PASS.
- `package-layout-exclusion.txt`: both package exclusion tests PASS.
- `typecheck.txt`: root, script, and package typechecks PASS.
- `build.txt`: complete repository build PASS.
- `bun-test-summary.txt`: full-suite totals, the 38 environment-sensitive
  failures, and every Hyperplan-related passing test.
- `bun-test.txt`: complete 700 KB local output, intentionally not committed;
  it remains in this evidence directory until worktree cleanup.
- `traex-fanout-partial.jsonl`: banner, backend reference read, five unique
  reviewer spawns, collective wait.
- `traex-service-unavailable.jsonl`: explicit six-thread run started but model
  service returned no first token; stderr remained empty.

## Why This Is Enough

OpenCode coverage proves the edited shipped skill is discoverable, loadable by
the real tool surface, still contains the Team Mode backend, and does not
pollute the user's database. Packaging checks prove both migration-era copies
ship with the new reference.

TraeX coverage proves the new backend is discovered and its first critical
orchestration boundary works: native backend selection and five-reviewer
fan-out. The remaining rounds use the same documented native lifecycle calls,
but their live completion remains a residual risk because the external model
service stopped returning tokens.

## What Was Omitted

- No credentials, authorization headers, environment dumps, or private config
  were captured.
- Raw OpenCode skill discovery output contains only project skill text and is
  retained locally as `opencode-debug-skill.json`.
- No real model API was called for OpenCode.
- No claim is made that the TraeX three-round debate or planner handoff
  completed.
