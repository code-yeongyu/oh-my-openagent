# init-deep-advisor component

Session-start advisor that reads `.omo/init-deep.json` and proposes rerunning the `init-deep` skill when the repo has drifted since the snapshot (or was never initialized). UI-only: no UI, no proposal. Decision state (declines, cooldowns, last-proposed HEAD) lives under `<omo-state>/init-deep-advisor-state/`, keyed by a sha256 of the repo's realpathed git common dir, so worktrees of one repo share state.

## Anatomy

| Path | Purpose |
|------|---------|
| `component.ts` | `session_start` (reason `startup` only) registration; preflight: hasUI, `omo-senpi-init-deep-advisor-disabled` flag, git repo check, onboarding-marker gate; lazy-imports the runtime (`omo-init-deep-advisor.js` when bundled). |
| `runtime.ts` | The driver: decline/cooldown/head gates, `computeEligibility`, `ui.select` with 60s timeout (`Run now` / `Skip this time` / `Never in this project` / `Never anywhere`), emits `omo-init-deep-advisor:run` via `sendMessage` (followUp, triggerTurn) plus an `omo-init-deep-advisor:proposed` entry. |
| `eligibility.ts` | Routes snapshot state to a trigger: missing snapshot -> coverage gap, invalid snapshot -> `snapshot-invalid`, valid -> drift thresholds; each eligible path names exactly one trigger. |
| `drift.ts` | `computeDrift` (commits since snapshot SHA, touched-file ratio, churn LOC ratio, days since) and `shouldProposeRefresh`. Unresolvable snapshot SHA -> `{ kind: "stale" }`, always eligible. |
| `coverage.ts` | Candidate-dir walk (depth <= 3, source-file heavy dirs) and `AGENTS.md` coverage ratio for the missing-snapshot path. |
| `state.ts` | Snapshot reader/validator, repo hash, atomic (tmp + rename, 0600) writers for global/project declines, cooldowns, last-proposed HEAD. |
| `proposed-data.ts` | `EligibilityResult` / `OmoInitDeepProposedData` shapes for the `:proposed` journal entry (`trigger`, `coverage` xor `drift`, `suggestedMode`). |
| `git-helpers.ts` | NUL-separated git plumbing: head, commit count, touched files, churn LOC, tracked totals; drift excludes `AGENTS.md`, `**/AGENTS.md`, `.omo/init-deep.json` themselves. |
| `git-exclude.ts` | Appends paths to `.git/info/exclude` (idempotent) for local-mode output. |
| `constants.ts` | Every threshold below, plus source extensions and excluded dir names. |
| `qa-*.sh` / `qa-rpc-*.mjs` | Manual QA harness for sandboxed end-to-end runs. |

## Drift model (constants.ts values, verify there before citing)

Refresh is proposed when ANY of:

- `commitsSince >= 30` AND `touchedRatio >= 0.15` -> trigger `commit-and-touch`
- `churnLocRatio >= 0.25` -> trigger `loc-churn`
- `daysSince >= 90` -> trigger `snapshot-age`
- snapshot SHA doesn't resolve to a commit, or the file is unparseable -> trigger `snapshot-invalid`

Missing snapshot uses coverage instead: propose init when `missingRatio >= 0.5` over candidate dirs (>= 8 source files or >= 500 LOC, depth 1..3, symlinks and vendor dirs skipped). Ratios divide by `max(denominator, 1)`.

Suppression, in order: global decline, project decline, 7-day cooldown (`COOLDOWN_DAYS`), same HEAD as last proposal. "Skip" and select timeout both write a cooldown; the last-proposed HEAD is written BEFORE the select, so a crash mid-prompt can't re-prompt on the same HEAD.

## Snapshot contract (`.omo/init-deep.json`, v1)

```json
{ "commitSha": "<hex>", "fileCount": 0, "loc": 0, "timestamp": 0, "mode": "local" }
```

`commitSha` string; `fileCount`/`loc`/`timestamp` finite numbers >= 0; `mode` is `"local" | "committed"`. Anything else reads as `invalid` (proposes refresh); ENOENT reads as `missing` (coverage path). The skill writes this file; the advisor only reads it.

## Lifecycle

session_start(startup) -> preflight (UI, flag, git repo, onboarding marker older than process start) -> gates (declines, cooldown) -> eligibility -> record proposed HEAD -> `ui.select` -> on "Run now", followUp message telling the agent to read `<builtin-skills>/init-deep/SKILL.md`, plus the `:proposed` entry with a `suggestedMode` derived from whether `AGENTS.md` is git-tracked.

## Anti-patterns

- Don't hardcode threshold numbers elsewhere; import from `constants.ts`.
- Don't count `AGENTS.md` or `.omo/init-deep.json` churn as drift; `DRIFT_EXCLUDES` exists precisely so the advisor's own output can't trigger it.
- Don't write decline/cooldown files non-atomically; `writeAtomic` (tmp + rename) is the only writer.
- Don't propose without recording the HEAD first, and don't unpause a declined repo programmatically; declines have no expiry by design.
