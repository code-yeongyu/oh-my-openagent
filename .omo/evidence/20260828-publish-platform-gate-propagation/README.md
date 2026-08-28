# Publish platform-package gate: registry propagation tolerance

Change: `.github/workflows/publish.yml`, step `Verify platform packages are published`
(job `publish-main`). Branch `fix/publish-platform-gate-propagation`.

## What was tested

The gate verifies all 24 platform packages (2 name families x 12 platform triples) exist in
the npm registry before the wrapper packages are published. It was a **single-shot** `curl`
per package with no retry, so one lagging read aborted the whole release.

Because the gate body lives inline in YAML, the test harness **extracts the real script text
from `publish.yml`** and runs it against a mocked `curl`/`sleep`, rather than testing a copy
that could drift from what ships.

- `gate-test.sh` - the harness (also runnable standalone)
- `gate-test-output.txt` - captured run of all four cases
- `actionlint.txt` - workflow lint, the repo's own `lint-workflows` gate
- `workflow-contract-test.txt` - `script/publish-release-platform-workflow.test.ts`, the repo's
  own assertion that this gate still refuses to publish wrappers
- `registry-headers-200.txt`, `registry-headers-404.txt` - root-cause evidence

## What was observed

Four cases, all PASS, executed on macOS **bash 3.2** - deliberately stricter than the
runner's bash 5.x for empty-array-under-`set -u` semantics:

| Case | Scenario | Expected | Result |
|---|---|---|---|
| A | all 24 visible immediately | exit 0, single round | PASS - 24 OK, no wait |
| B | 3 packages lag, appear after round 2 | exit 0 after retries | PASS - reproduces and heals the production failure |
| C | 1 package never appears | exit 1, names it | PASS - same hard error, gate NOT weakened |
| D | `curl` itself exits nonzero (network) | treated as pending, no crash | PASS - `000` is not read as absence |

`actionlint` exit 0.

### Regression caught in CI and fixed

The first push failed `test (ubuntu-latest, 2/2)`:
`script/publish-release-platform-workflow.test.ts` asserts the workflow contains the literal
string `Missing platform package(s); refusing to publish wrappers.`, and the first draft had
rewritten that message to interpolate the attempt count mid-sentence, breaking the substring
match. The contract string is now preserved verbatim and the attempt count moved to trailing
context, so the guard keeps proving the gate refuses to publish wrappers. That suite is
14 pass / 0 fail (`workflow-contract-test.txt`); the test was NOT relaxed to accommodate the
change.

### Root cause

The production failure (run 33146967411) had **all 12 platform build jobs and all 12 platform
publish jobs green**, yet the gate reported 3 of 24 missing and aborted. Those 3 packages were
manually confirmed `HTTP 200` in the registry shortly after, and re-running the failed job
alone completed the release with no code change.

Measured registry behavior:

- existing version -> `HTTP 200` with `cache-control: max-age=300`, `cf-cache-status: DYNAMIC`
- absent version -> `HTTP 404` with **no** `cache-control` and **no** `cf-cache-status`,
  identical with a `Cache-Control: no-cache` request header

So this is **read-path propagation lag after a successful write, not CDN negative caching**.
Cache-busting headers were therefore rejected as a placebo; bounded retry is the actual remedy.

### Precedent

The same workflow already treats this exact hazard for `omo-ai` in `post-publish-verify`:
`for attempt in $(seq 1 5)` + `sleep 15`, logging "registry propagation", failing hard after
the last attempt. This gate simply never received that treatment. The fix reuses that idiom.

## Why it is enough

Case B is the production failure reproduced deterministically and shown to heal; case C proves
the gate still blocks a genuinely unpublished package, which is the gate's whole purpose. The
harness runs the shipped script text, so it cannot pass against a stale copy. The deadline is
20 attempts x 15s (~5 min), generous against the observed lag of seconds while still surfacing
a real failure well inside the release window; both are overridable via
`PROPAGATION_ATTEMPTS` / `PROPAGATION_DELAY` for testing.

## What was omitted

- No live re-publish was performed: that would require burning a real version number. The
  registry-lag condition is instead reproduced by mocking the probe, and the observed
  production run is cited as the real-world occurrence.
- The sibling `Check if already published` steps in the same job remain single-shot by
  design. A stale read there causes a duplicate-publish attempt that npm rejects outright,
  which is a loud, safe failure rather than a wrapper referencing a missing dependency.
  Changing publish idempotency is deliberately out of scope for this focused fix.
- No secrets, tokens, or auth headers are captured in any artifact here.
