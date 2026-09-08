# The published smoke never installed anything

## What was tested

`script/published-install-smoke.mjs`, the new step in the `lazycodex-published-smoke` job, run
against real published payloads with the sandbox the script creates itself.

- RED: `node script/published-install-smoke.mjs --package=oh-my-openagent@5.0.0-beta.43`
- GREEN: `node script/published-install-smoke.mjs --tarball=<beta.43 tarball + the prompts-core directive>`
- Unit: `bun test script/published-install-smoke.test.ts`
- Regression: `Bun.YAML.parse` of the edited `.github/workflows/ci.yml`

## What was observed

| Input | Result |
| --- | --- |
| `--package=oh-my-openagent@5.0.0-beta.43` (the payload missing the prompts-core directive) | exit 1, `published install smoke failed: npm run sync:skills failed ...` (`red-install.log`) |
| same tarball plus `packages/prompts-core/prompts/ultrawork/codex.md` | exit 0, `published install smoke OK (1 plugin(s), ...)` (`green-install.log`) |
| `bun test script/published-install-smoke.test.ts` | 3 pass / 0 fail |
| mutation: drop `skills/ultrawork/SKILL.md` from the required list | 1 of 3 tests fails, green again on revert |
| `.github/workflows/ci.yml` after the edit | `continue-on-error: true` kept, both dry-run assertions kept, new steps appended (`yaml-regression.log`) |

The job as it stands today cannot produce that RED at all: it only runs `--dry-run` commands, which
never touch a payload.

## Observed in CI on this branch

`ci-run.log`, from the `lazycodex-published-smoke` job of run 34023407423:

```
published install smoke OK (1 plugin(s), .../omo/4.19.4)
published install smoke passed for lazycodex-ai@latest
published install smoke failed: npm run sync:skills failed ...
published install smoke failed for lazycodex-ai@beta
published install smoke OK (1 plugin(s), .../omo/4.19.4)
published install smoke passed for oh-my-openagent@latest
published install smoke failed: npm run sync:skills failed ...
published install smoke failed for oh-my-openagent@beta
```

Both stable payloads install; both 5.0.0-beta.43 payloads fail, which is exactly the pair of defects
the dry-run-only job shipped past. The first CI run of this step covered `@latest` only, which
resolves to 4.19.4 and installs cleanly, so the beta tag was added and is smoked too.

## Why it is enough

The RED input is the published tarball itself, so the smoke is proven against the exact artifact a
user installs, and the GREEN differs from it by one file. The unit test's mutation proof shows the
artifact assertions can fail. The YAML parse shows the existing dry-run contract survived the edit.

## What was omitted

No secrets appear in the logs; they carry local sandbox paths only. The smoke removes its own
`mkdtemp` sandbox in a `finally` block unless `--keep` is passed, so no CODEX_HOME, bin dir, or
extracted tarball survives a run.
