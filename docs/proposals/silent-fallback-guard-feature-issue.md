## Problem

Coding agents can silently introduce fallback logic that was never requested by the user: default values, swallowed errors, compatibility paths, or silent degradation. In data-intensive systems, these fallbacks are not harmless convenience code — they can contaminate downstream data, hide upstream failures, and create expensive debugging and recovery work.

This issue is **not** about model/provider fallback. The guard is not model/provider fallback. It is about agent-generated *code* fallback patterns that make it into the working tree without explicit justification.

As an engineer working with large-scale data pipelines, I have repeatedly seen coding agents introduce fallback behavior that was never requested: default values, swallowed errors, compatibility paths, or silent degradation. In data systems, those fallbacks are not harmless convenience code — they can contaminate downstream data, hide upstream failures, and create expensive debugging and recovery work. This proposal is motivated by that failure mode: agent-generated fallback logic should be surfaced and justified, not silently merged into the codebase.

Common examples include:

```ts
const name = user.name || "Anonymous";
```

```python
timeout = os.getenv("TIMEOUT") or 30
```

```ts
try { risky() } catch { return []; }
```

These patterns are sometimes correct, but when introduced without context they become hidden assumptions that break data contracts and observability.

## Proposed solution

Add an **opt-in, experimental Silent Fallback Guard** lifecycle hook that runs on `session.idle`, inspects the working-tree diff for supported languages, detects fallback-like code, and asks the agent/user to justify each candidate before finishing the task.

**Core principle: Detection is deterministic; judgment is delegated.**

The guard is intentionally *candidate-based*, not a correctness verdict. It narrows suspicious lines using a shared risk taxonomy and lets the agent decide whether each fallback is required.

### V1 scope

- **Placement**: first-class lifecycle hook in `packages/omo-opencode/src/hooks/silent-fallback-guard/`.
- **Registration**: registered in the session hook composer and dispatched via the existing event hook dispatcher.
- **Trigger**: `session.idle`, deduplicated by diff hash per session so repeated idle events do not re-prompt.
- **Mode**: report/pushback-oriented, **fail-open**, **disabled by default**.
- **Languages**: JavaScript/TypeScript and Python.
- **Detection**: normalized lexical scanning (no AST in V1).
- **Diff source**: tracked staged + unstaged changes to supported files. Untracked files are reported as skipped in V1.
- **Budget**: max 20 review candidates, max 5 per file, max 8 per risk type. Low-confidence candidates are excluded from review by default and summarized.
- **Safety protocol**: detect aggressively, delete conservatively, ask when context is insufficient, always report.

### Risk taxonomy (V1)

- `DEFAULT_VALUE`
- `NULLISH_FALLBACK`
- `ERROR_SWALLOW`
- `CATCH_RETURN_DEFAULT`
- `OPTIONAL_DEGRADATION`
- `COMPAT_SHIM`
- `ENV_FALLBACK`
- `BEST_EFFORT`
- `SILENT_RETRY_OR_IGNORE`

### Decision states

Each reviewed candidate is classified as one of:

- `KEEP` — fallback is justified by plan, tests, or project instructions.
- `REMOVE` — obvious slop with no supporting context.
- `USER_DECISION` — context is insufficient; ask the user with numbered options.
- `SKIPPED_BUDGET` — candidate was outside the review budget and summarized.

### Ambiguous fallback question example

When the guard cannot determine whether a fallback is required, it asks the user a structured question such as:

```
Fallback candidate in src/pipeline/parse.ts:42:
  const timestamp = row.timestamp || Date.now()

1. Remove fallback and fail on missing timestamp.
2. Keep fallback because missing timestamps are expected.
3. Replace with explicit quarantine/logging path.
```

## Alternatives considered

1. **AST-based detection** — deferred to a later iteration. V1 uses normalized lexical scanning to keep the guard lightweight and avoid parser dependencies for multiple languages.
2. **Default-on blocking** — rejected. V1 is opt-in and fail-open to avoid disrupting existing workflows while the false-positive rate is measured.
3. **Automatic deletion** — rejected. The guard only surfaces candidates; the agent/user decides.
4. **General static-analysis framework** — rejected. The guard focuses narrowly on silent fallback patterns.

## Additional context

### Non-goals

- This is not a change to model/provider fallback (`model_fallback`, `runtime_fallback`).
- It does not guarantee detection of all fallback logic.
- It does not implement AST parsing in V1.
- It does not block completion by default.

### Maintainer questions

1. Is the session/continuation hook tier the right home for this guard, or would you prefer a different tier?
2. Should the diff source include untracked files in a later iteration, or is tracked-only the correct V1 boundary?
3. What false-positive rate would be acceptable before graduating the guard out of experimental status?
4. Should the public contribution target branch be `dev` for this feature?
