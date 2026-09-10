# What was observed

## Executor and doctor

`task-15-executor-verify.log` records four CLI exits of 0: fresh evidence and an unstat-able transcript produced exactly empty stdout; stale evidence produced `decision: block` with `stale`; the short receipt produced `decision: block` with `placeholder`. The timestamp comparison was recorded explicitly. No worker agent or model performed the QA.

`task-16-doctor.log` records the inventory and report row in source and generated skills. PASS means CLI >= 0.153.1 and absent cache or Astra present; WARN means older CLI or present cache without Astra. The root configured model is informational; the bundled catalog default drives the verdict. The table command returned only `5` pipe-delimited fields, i.e. three content columns. The upstream version/tag fact was read from the committed skill, not independently rediscovered in this ship task.

## Installer and live hook wiring

The installer self-test passed. The separate fresh install passed Astra/600000, high/xhigh reasoning, 12 agent blocks, 12 Astra TOMLs, and no thread-cap keys. The plan's installed/source hook equality failed: installed macOS manifest 19 versus source 21. Existing `packages/omo-codex/src/install/codex-git-bash-hooks.ts` removes two Windows-only Git Bash hooks off Windows (commit `c754caba8`). The assertion remains failed; no product change was made to force 21 onto macOS.

The PATH-resolved real binary reported codex-cli 0.147.0, not the plan's earlier 0.144.1. Live turns used only `mock-model`. Corrected app-server self-test and plugin runs returned `ok: true`, completed turns, and the expected mock assistant text. Plugin evidence includes matching `hook/started` and `hook/completed` run IDs for `session-start-loading-project-rules` and `user-prompt-submit-checking-ultrawork-trigger`, with no failed or missing expected hooks. Stop events also completed.

The app-server emitted diagnostics for untrusted repository-local config and a TCC-denied scan of the host `omowright` skill. Those diagnostics are retained; the requested plugin events nevertheless completed. Initial app-server copy invocations returned 0 without a JSON summary because the `/var` path alias did not match the canonical import URL. They are invalid proofs, retained separately; canonicalizing the QA-only temporary path produced actual first-party events. Initial Bun build syntax similarly returned help with exit 0; the actual package build then ran successfully.

## Remote gate classification

The supplied receipt ran on gorky (Linux x86_64, Bun 1.4.0, Node v24.20.0). mengmotaMac's load was 58.08 > 18, so it was not selected. Branch HEAD was `097ba78c943501bc22e9367bb979015ef3ae4074`; dev baseline was `73f0ddd147901fbb9a12f038a3db4942187ec71d`.

- `[a] test:codex`: exit 1. Paired bin-link runs also exited 1 identically on branch and dev: PRE-EXISTING/ENV, not green.
- The orchestrator summary names the Node fallback and both-runtimes error cases. The full receipt additionally lists the actionable-install-hint case: three failures, all in `install-bin-links.test.mjs`, with identical assertions on dev. All three remain visible.
- `[b]` installer freshness: exit 0 (2 pass).
- `[c]` and `[d]`: exit 1, no files matched by Bun. These are runner mismatches, not successful test commands. Component tests use Vitest; contract cases and lcx-bug-skills use Node. The later `[f-node]` plugin suites passed on both branch and dev, 337/337 each, including representative bundled CLI contracts and skill frontmatter.
- `[e]` tsc and Biome: exit 0 each; `[f-build]`: exit 0 on both checkouts.
- Remote cleanup: exit 0; subsequent directory lookup returned the expected absence.

## Isolation

Real `~/.codex/config.toml` shasum before: `b012e531f5aa9fb1bce9003593c3eadf07081fcd`.

Real `~/.codex/config.toml` shasum after: `b012e531f5aa9fb1bce9003593c3eadf07081fcd`.

The temporary fixture/QA-copy roots were removed. Codex-qa's isolated homes were removed by its cleanup trap, with explicit absence checks recorded in `task-17-ship.log`. No real Codex auth file was copied or inspected.
