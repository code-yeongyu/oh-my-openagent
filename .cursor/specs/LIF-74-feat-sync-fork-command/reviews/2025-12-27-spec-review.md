# LIF-74 /sync-fork — Spec/Plan/Tasks Review (Pre-Implementation)

**Date**: 2025-12-27  
**Spec folder**: `.cursor/specs/LIF-74-feat-sync-fork-command/`  
**Linear**: LIF-74 (In Review)

## Executive Summary

Spec aligns with Linear LIF-74 goals: compare fork vs upstream, filter valuable commits (security/fix/perf), generate recommendations + scaffold steps, and integrate with existing review workflow via agent-consumable JSON. Plan/tasks are broadly complete and follow repo conventions (Bun-only, tool folder structure, Git CLI only).

Main gaps are **internal contradictions** (scoring model vs “simple categorical priority”; `--script` mentioned after removal; single-value `filter` type vs multi-filter story), plus a few **missing/under-scoped requirements** (already-synced detection via `git patch-id`, “recurring sync since last run” state semantics, “offline” definition vs `git fetch`). Resolve these before implementation to avoid rework.

## Passed Checks

- **Spec ↔ Linear alignment**: matches issue requirements (compare branches, filter, report, cherry-pick workflow, integrate with review commands).
- **Architecture alignment**: plan uses standard tool pattern (`src/tools/<name>/...` + `.opencode/command/*.md`), isolates Git side effects to `GitAdapter`.
- **Performance awareness**: tasks explicitly call out delimiter-safe `git log` parsing and avoiding per-commit spawns.
- **OmO consumption**: `SyncRecommendation` includes fields OmO can map directly to `linear_create_issue` (title/body/labels/priority/cherry-pick command).
- **Edge-case coverage**: missing upstream, shallow clone, 1000+ commits, merge commits, non-conventional commits, unrelated histories all considered.

## Issues Found

### Critical

1) **Priority/scoring model contradiction**
- Spec/plan contain a numeric `PriorityScore` (ValueScore/RiskScore/ConflictProb formula + thresholds).
- Tasks Phase 5 explicitly says “simple rules, not complex formulas” and defines categorical `P0–P3`.
- Risk: implementation churn, mismatched outputs, unstable UX (“why is this ranked above that?”).

**Recommendation**: pick one for MVP.
- MVP: deterministic categorical `P0–P3` + stable sort tie-breakers (type → risk → recency). Add numeric scoring later as P2.
- If keeping numeric scoring: define calibration targets + explainability fields (`why` strings) and keep formula/weights in `constants.ts`.

2) **`--script` inconsistency across artifacts**
- `spec.md` says `--script` removed.
- `plan.md` still shows `--script` in command interface examples.
- `tasks.md` also marks `--script` removed.

**Recommendation**: remove `--script` everywhere (preferred; aligns with “no side effects” and existing workflow commands). If script is desired, move it to explicit `--write-script` + strict safety gating + clear location.

3) **Filter semantics mismatch (single vs multi)**
- User story expects combined filter: `--filter fix,security`.
- `SyncForkArgs.filter` in plan/spec types is single enum value.

**Recommendation**: change args to support list.
- Either `filter?: Array<...>` in tool args schema, or accept comma-separated string and parse.
- Keep `all` as default; dedupe, stable sort.

### Major

4) **“Offline” requirement conflicts with `git fetch upstream`**
- NFR says “No external network calls for core function” / “100% offline capable”, but plan’s default flow fetches upstream.

**Recommendation**: define “offline” precisely.
- Option A (real offline): default `--no-fetch` and require existing `refs/remotes/upstream/*` to be present.
- Option B (no external APIs): allow `git fetch` but no HTTP APIs; rename requirement to “no external API dependencies” and add `--no-fetch` for airgapped runs.

5) **Recurring sync state semantics unclear vs acceptance scenario**
- US-006 scenario expects default behavior “only commits since last sync”.
- State persistence appears “Optional P2” in spec; tasks don’t implement last-sync gating as default.

**Recommendation**: make behavior explicit.
- Minimal: store last run metadata; show “since last run” info but don’t change default selection.
- Or: add `--since last` / `--use-state` flag to narrow commit range.

6) **Already-synced detection (patch-id) is specified but not scheduled**
- FR-016 + edge-case table mention `git patch-id`.
- No explicit tasks for computing patch-ids (this is non-trivial for large N).

**Recommendation**: treat as P2 and scope it with guardrails.
- Implement only when `--detect-already-synced` set, and/or when N <= small threshold.
- Document accuracy trade-offs.

7) **Integration with `/review-pr` and `/deep-review-project` is stated but not implemented**
- Spec says those commands “recognize sync PR” / “validate P0 included”.
- Plan/tasks only mention suggesting next commands, not modifying those tools/commands.

**Recommendation**: clarify scope.
- For LIF-74, integration likely means “print guidance + emit metadata”, not modifying reviewers.
- If reviewer behavior change required, create follow-up issue.

### Minor

8) **Tool output contract: add versioning**
- JSON output consumed by OmO should be stable.

**Recommendation**: include `resultVersion: 1` (or `schemaVersion`) in `SyncForkResult`.

9) **Security keyword set: good start, but likely misses common classes**
- Current list includes many; misses some high-signal terms.

**Recommendation**: add (at least) `supply chain`, `prototype pollution`, `redos`, `xxe`, `open redirect`, `sql injection`, `command injection`, `privilege escalation`, `directory traversal` (alias), `bypass`.

10) **Tests note is outdated/inaccurate**
- Tasks claim “test framework not configured”, but repo has `tests/` + `bun test` script.

**Recommendation**: keep unit tests for pure parsers/scorers as part of implementation (cheap + high value).

### Suggestions

11) **`--dry-run` flag not needed**
- Command is analysis-only (unless writing scripts/state). Focus on `--no-fetch` / `--fetch` / `--scaffold`.

12) **`--json-schema` flag optional**
- If OmO is only consumer, version field likely enough.
- Add schema only if external tooling expects it.

## Recommendations for Implementation (Simple-First)

1) Lock CLI + JSON contract early: `filter` list behavior, `output` options, `resultVersion`, `--no-fetch`.
2) Choose **one** prioritization strategy for MVP (categorical P0–P3 recommended).
3) Keep Git operations bounded (≤ ~5 invocations) for N up to 1000; add degrade rules.
4) Make patch-id detection opt-in/P2 to protect perf.
5) Add table-driven unit tests for: commit parsing, security heuristics, delimiter parsing, deterministic grouping.

## Open Questions for Product Owner

1) Should “offline” mean **no network at all**, or “no external APIs/deps” (git fetch allowed)?
2) Should combined filters (`--filter fix,security`) be first-class requirement (seems yes from US-002)?
3) Do we want numeric `PriorityScore` (explainable ranking), or is categorical P0–P3 enough for MVP?
4) Is “since last sync” default behavior required, or acceptable behind `--use-state`?
5) Is `git patch-id` already-synced detection required for MVP, or can it be deferred/opt-in?

## Notes / Observations

- LSP tools appear unavailable in this environment (“No LSP server configured for .ts”), so pattern alignment checks relied on file structure + existing tool implementations, not symbol queries.
- A duplicate spec folder was created by tooling during this session: `.cursor/specs/LIF-74-feat-lif-74-feat-sync-fork-command/` (likely accidental). Consider removing separately if not needed.
