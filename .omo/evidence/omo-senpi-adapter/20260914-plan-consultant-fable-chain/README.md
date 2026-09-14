# QA evidence: plan-consultant chain heads with Fable 5.1 max (#8259)

Change under test: `packages/senpi-task/src/agents/builtin/fallback-chains.ts` (`plan-consultant`
-> `claude-fable-5-1 (max)` -> `claude-opus-5 (max)` -> `kimi-k3 (max)`; `explore` / `librarian`
utility rung back on `qwen3.7-plus`), the mirrored `metis` chain in
`packages/model-core/src/agent-model-requirements.ts`, the new parity guard
`packages/omo-senpi/src/components/task/builtin-agent-chain-parity.test.ts`, and the regenerated
plugin bundles under `packages/omo-senpi/plugin/extensions/`.

Base for every RED capture: `dev` at `b3c5e4794`. Unit gates ran on a remote macOS runner
(Bun 1.4.2) inside a throwaway worktree, never on the developer checkout.

## What was tested

| # | Surface | Command (repo root) | Artifact |
|---|---------|---------------------|----------|
| 1 | RED: new pins fail on base tables | `bun test packages/model-core/src/model-requirements-agents.test.ts packages/senpi-task/src/agents/builtin/fallback-chains.test.ts` and `bun test --timeout 20000 packages/omo-senpi/src/components/task/builtin-agent-chain-parity.test.ts` with only the test edits applied | `01-red-c1-c2.log` |
| 2 | GREEN: same pins after the table edits, plus the adjacent suites (`packages/model-core`, `packages/senpi-task/src/agents` + `src/category`, omo-senpi planner / engine-agents / config-startup / telemetry, omo-opencode delegate-task + agents) | see the `RESULT <label> exit=<code>` lines | `02-green-c1-c2-c3.log` |
| 3 | Real resolution through `resolveAgent(name, BUILTIN_AGENTS, registry)` for four registry shapes, on base and on the patched tree | `bun run chain-probe.ts <repo>` | `03-chain-probe-base-vs-patched.json.log`, `chain-probe.ts` |
| 4 | Bundle regeneration in the CI freshness environment (linux/amd64 container, Node 24, Bun 1.4.2) followed by `build-extension.mjs --check` and `build-install.mjs --check` | `node packages/omo-senpi/plugin/scripts/build-extension.mjs` then `... --check` | `04-bundle-linux-amd64.log` |
| 5 | Live senpi with the regenerated plugin installed in an isolated agent dir | `SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/drive.mjs` (after `--self-test`) | `05-drive-live.log` |

## What was observed

1. RED (`01-red-c1-c2.log`): C1 exit 1 - `metis` pin and the senpi-task length + table pins fail
   with `claude-sonnet-4-6` received where `claude-fable-5-1` is expected (3 fail / 15 pass); C2
   exit 1 - the parity test fails for `plan-consultant`, `explore`, `librarian` and passes for
   `plan-reviewer` (3 fail / 1 pass). Every failure is an assertion diff on model ids, not an
   import or syntax error.
2. GREEN (`02-green-c1-c2-c3.log`): C1, C2, C3a (model-core), C3c (omo-senpi) exit 0 on the
   first run; C3b (senpi-task agents + category) and C3d (omo-opencode delegate-task + agents)
   exit 0 after two head-tracking pins were moved to the new head
   (`senpi-task/src/category/anthropic-lane.test.ts`, `omo-opencode/src/agents/utils.test.ts`).
3. Chain probe (`03-...`), plan-consultant row per registry, base -> patched:
   - Claude subscriber (`claude-sdk-oauth` + `opencode` both serving fable-5-1 / opus-5 / sonnet-5 /
     sonnet-4-6): `claude-sdk-oauth/claude-sonnet-4-6` (no variant) -> `claude-sdk-oauth/claude-fable-5-1`
     `max`, fallback `claude-sdk-oauth/claude-opus-5`. The subscription lane still wins (#8051).
   - Copilot-only (opus-5, gpt-6-astra, haiku on `github-copilot`): `github-copilot/claude-opus-5` `max`
     on both trees - Fable 5.1 is not served by Copilot, so the documented Copilot default is the
     second rung.
   - Kimi-only: `kimi-for-coding/kimi-k3` (no variant) -> `kimi-for-coding/kimi-k3` `max`.
   - No chain model: `model_unavailable` on both trees.
4. Bundle (`04-...`): `arch=x86_64 node=v24.19.0`, `bun=1.4.2`; five extensions built;
   `omo-senpi extension build is current` and `omo-senpi installer is current`. Only
   `omo.js`, `omo-task.js`, `omo-init-deep-advisor.js` changed against `dev` (marker line, plus the
   chain content in `omo-task.js`). The same build also produced a different
   `omo-agent-toolkit.js`; that bundle is not covered by `--check` and had already drifted from its
   source on `dev`, so it was restored to the committed bytes and tracked separately as #8263.
5. Live drive (`05-...`): `result: PASS`, `ultraworkInjected: true`, `commentChecker: PASS`,
   `realSenpiChangedPaths: []`, `realOmoChangedPaths: []`, `realSenpiProtectedStateComplete: true`,
   `realOmoProtectedStateComplete: true`. `realSenpiUntouched` / `realOmoUntouched` read `false`
   only because directory identity was unavailable on the runner; the changed-path lists are empty.
   Isolated agent dir: a `omo-senpi-qa-*/agent` temp directory created by the driver.

## Why it is enough

The change is a data table plus its documentation. The pins prove the tables carry exactly the
intended rungs; the parity test proves the senpi mirror can no longer drift from model-core
silently (it fails on `dev` today); the probe proves the real resolver picks the new head for a
Claude subscriber and degrades to Opus 5 / Kimi K3 / unavailable exactly as the docs now state; the
Linux rebuild proves the committed bundles pass the CI freshness gate; the live drive proves the
regenerated plugin still loads and its hooks fire in a real senpi session in isolation.

## What was omitted

- No provider credentials, tokens, or auth files were read or copied; the probe uses a fake
  registry object, the live driver uses its own sandbox.
- Home directory paths are shortened to `~` and machine names removed from the logs.
- The long GREEN suite output is reduced to per-file results and totals; C1 / C2 are kept in full.

## Cleanup

Remote worktrees (`<remote-worktree-root>/omo`, `<remote-worktree-root>/base`) and the probe
script were removed after the final gate, and the build container ran with `--rm`. Receipt: see the
final section appended below.

## Cleanup receipt

- Remote runner: `git worktree remove` for `<remote-worktree-root>/omo` and `<remote-worktree-root>/base`,
  `git worktree prune`, `rm -rf <remote-worktree-root>`; verified `ls -d <remote-worktree-root>` ->
  "No such file or directory", `git worktree list | grep pc-chain` -> none, no leftover processes.
- Build container `omo-bundle-pc-20260914` ran with `--rm`; `docker ps -a --filter name=omo-bundle-pc-20260914` -> 0 rows.
- Local worktree: Linux `node_modules` created by the container removed before committing.
- Final gate on the pushed HEAD (`4ed15c12d`), same six commands as row 2: all exit 0 (`FINAL_DONE all-green`).
