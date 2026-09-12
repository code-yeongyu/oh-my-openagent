# LazyCodex smoke readiness budget (issue #8182)

Scope: `.github/workflows/publish.yml` `Smoke test published lazycodex-ai` + one executed-budget test.

## Change
- `smoke_lazycodex_package()`: `for attempt in $(seq 1 12)` / `sleep 10` -> `SMOKE_READINESS_ATTEMPTS=60`,
  `SMOKE_READINESS_INTERVAL_SECONDS=15` (15 min, same shape as the omo-ai readiness loop in the same job).
- Timeout message names registry propagation and says the publish may have succeeded.
- New `script/publish-lazycodex-smoke-budget.test.ts`: executes the step's run block with bash-function stubs
  (`npm` absent for N views, `npx` failing, `sleep` recording); asserts the loop reaches the package after 20 views
  and that the exhausted budget sleeps >= 900 s and names propagation.

## Verification
- actionlint (`-shellcheck=''`) + `Bun.YAML.parse` locally.
- Remote (mengmotaMac via bunshin): new test RED against `origin/dev`'s workflow, GREEN on the branch; all 20 suites
  that read `publish.yml` GREEN; `typecheck:script` clean.
