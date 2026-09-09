## What / Why

This hardens LazyCodex worker completion receipts and makes the doctor skill report whether the installed Codex is ready for the bundled Astra default.

- Reject evidence with fewer than 40 characters after trimming. Reject stale receipts when evidence `mtimeMs` predates transcript `birthtimeMs`, using `ctimeMs` when birthtime is unavailable. If the transcript cannot be stat'ed, skip the stale check (fail open) rather than inventing a first-seen timestamp that would reject legitimate earlier receipts.
- Name `placeholder` and `stale` in block reasons. Keep evidence-root containment, the `EVIDENCE_RECORDED:` marker, and the `^lazycodex-worker-(low|medium|high)$` matcher. The worker directive adds a sentence requiring evidence from this run with actual command output; fixtures now use substantive receipts and cover the freshness cases.
- Add an `Astra readiness` inventory/report row to `lcx-doctor`, keyed to the catalog default rather than a user-selected root model. PASS requires codex-cli 0.153.1 or newer and an absent cache or cached Astra entry; WARN covers an older CLI or a present cache missing Astra, with upgrade/restart remediation.
- Regenerate the installer bundle for the `5.0.0-beta.49` version stamp. The initial diff contained only the generated digest line and embedded beta.48 -> beta.49 version; no installer source changed. A subsequent regeneration left the tracked tree clean.

Addresses #114

## Observed

### Local, non-agentic QA

- Actual plugin build and local tsgo: exit 0. The requested `bun --cwd ... run build` spelling returned help with exit 0 on this machine; `bun run --cwd packages/omo-codex/plugin build` executed the real build successfully.
- `install-verify.sh --self-test`: exit 0. A separate fresh isolated install passed Astra/600000, high/xhigh reasoning, 12 agent blocks, 12 Astra TOMLs, and no thread-cap keys.
- **Hook-count plan discrepancy remains visible:** source manifest has 21 paths, installed macOS manifest has 19. The strict equality assertion failed. Existing `codex-git-bash-hooks.ts` removes the two Windows-only Git Bash hooks off Windows; this PR does not alter that behavior or claim the 21-installed-path assertion passed.
- Raw-pipe SubagentStop: fresh 200-character receipt -> empty stdout; receipt aged with `touch -t 202601010000` -> JSON block naming `stale`; `placeholder evidence` -> block naming `placeholder`; `/nonexistent` transcript plus 200-character receipt -> empty stdout. All CLI exits were 0, and each case used independent scratch state.
- Real codex-cli 0.147.0 with isolated `CODEX_HOME` and local `mock-model`: app-server self-test and plugin turn completed. Matching `hook/started` and `hook/completed` events include project rules and the ultrawork trigger, with no missing/failed expected hooks. Doctor QA was by read, not `lazycodex doctor`.
- Real `~/.codex/config.toml` shasum before and after: `b012e531f5aa9fb1bce9003593c3eadf07081fcd`. Temporary QA roots and isolated homes were removed.

The app-server skill/client/mock were byte-identical disposable copies, with only mock startup readiness changed in the copied common helper to a bounded FIFO event read rather than polling. An initial `/var` alias entry-guard no-op was rejected as invalid evidence; canonicalizing the QA temporary path yielded the real JSON/events. Both invalid receipts and corrected proofs are retained. Codex's untrusted-project and TCC-denied host-skill-scan diagnostics are also retained, not suppressed.

### Remote gate and orchestrator classification

Machine: **gorky**, Linux x86_64, Bun 1.4.0, Node v24.20.0. mengmotaMac was not selected because its load was 58.08 > 18. Branch receipt HEAD: `097ba78c943501bc22e9367bb979015ef3ae4074`; dev baseline: `73f0ddd147901fbb9a12f038a3db4942187ec71d`.

- `[a] test:codex TEST_EXIT=1`; supplemental bin-links also exit 1 on both branch and dev. The orchestrator classified the Node-fallback and both-runtimes-error cases as **PRE-EXISTING/ENV**, reproducing identically on the same-machine dev clone. The full receipt also lists the actionable-install-hint case: three `install-bin-links.test.mjs` failures in total, all identical on dev. This remains a red gate, not a green result.
- `[c]` and `[d]`: exit 1 because `bun test` matched no files. These are runner mismatches: component tests use Vitest, while bundled contract cases and lcx-bug-skills run under `node --test`. The orchestrator's coverage classification references `[f-node] NODE_TEST_EXIT=0` on both branch and dev: 337/337 plugin tests each, including representative CLI contracts and skill frontmatter. No separate new executor Vitest run is claimed.
- `[b]` freshness: exit 0, 2 pass. `[e]` tsc and Biome: exit 0. `[f-build]`: exit 0 on both branch and dev.
- Remote cleanup exited 0 and the checkout was absent afterward. The supplied receipt and all failing assertion output are retained. No Bun unit tests ran locally.

## QA evidence

All paths are under `.omo/evidence/20260908-lcx-hardening/`:

- `task-15-executor-verify.log`: raw-pipe payloads, timestamps, exact stdout, and decisions.
- `task-16-doctor.log`: source/generated skill reads and uniform table columns.
- `task-17-ship.log`: installer regeneration, actual plugin build, invocation incidents, cleanup, config shasums.
- `task-17-install-self-test.log` and `task-17-install.log`: isolated installer checks, including the 19/21 failed assertion.
- `task-17-app-server-self-test.log` and `task-17-app-server-plugin.log`: real mock-provider JSON summaries and first-party hook events; corresponding `-no-op.log` files preserve invalid initial attempts.
- `task-17-typecheck.log`: local tsgo exit 0.
- `task-gate-c-remote-tests.log`: original remote outputs, paired dev baseline, cleanup, and appended `----- orchestrator classification -----`.
- `task-17-qa.py`: reproducible evidence-only driver; no product or skill source edits.
- `NOTE-volume-incident.md`, `what-tested.md`, `observed.md`, `why-enough.md`, `omitted.md`: scope, recovery provenance, results, and limitations.

The original worktree became unreachable through macOS TCC; its uncommitted task-15/16 logs were stranded. These proofs were regenerated in the inboard clone from the pushed commits.

## Residual risk / handoff

The 40-character floor is not proof of semantic truth, and freshness depends on filesystem timestamps. Transcript-stat failure intentionally permits the receipt. Existing context-pressure and retry-cap escape paths remain. Real Astra model availability was not exercised: live turns used only the local mock, and codex-cli 0.147.0 is below the documented 0.153.1 floor. The upstream floor was read from the committed skill, not rediscovered here.

The installed-hook-count plan mismatch and baseline-red remote gate remain explicit. No source changes or test weakening were made to hide either result. This child opens the PR only; the orchestrator owns CI/review follow-through and merge. No merge or release action has been performed.
