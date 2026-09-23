# Merged plugin: isolated real Senpi smoke

## What was tested

From `/Users/cminseo/Developer/omo-model-latest`, after the final merged
sources were rebuilt:

```sh
node packages/omo-senpi/scripts/qa/drive.mjs --self-test
node .agents/skills/senpi-qa/scripts/resolve-evidence-dir.mjs --repo-root /Users/cminseo/Developer/omo-model-latest --slug 20260923-latest-model-versions-merge
SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/drive.mjs
```

The resolver produced this evidence directory. The driver used the real
Senpi binary at
`/Users/cminseo/.local/lib/node_modules/omo-ai/node_modules/.bin/senpi`,
the worktree plugin, and a local mock provider; no paid inference.

## What was observed

- Self-test: exit 0, `SELF-TEST OK`.
- Live driver: exit 0, `result: PASS`, `ultraworkInjected: true`.
- Exact receipt: `drive.json`.
- The caller's agent directory was ignored.
- Isolated agent directory:
  `/private/var/folders/tz/9h9jcw_s2jn6qm8cfsn5tkr40000gn/T/omo-senpi-qa-pUWNRW/agent`.
- Environment receipt observed: true. All changed-path arrays were empty.
- Real Senpi and OmO protected-state snapshots were complete with no
  protected-state errors.
- After the driver exited, `test ! -e` on the sandbox root succeeded:
  `QA_SANDBOX_REMOVED`. The driver waits for child completion and removes
  the sandbox in its `finally` block.

## Why it is enough

A fresh real process loaded the regenerated worktree plugin and handled
its ultrawork hook. Routing-specific behavior is additionally exercised
through the actual public core/Senpi APIs in
`../../20260923-latest-model-versions/merge-routing-qa.ts`, with the exact
results in `merge-routing-qa.log` next to that script. The package gates
cover the pinned complete provider/model/variant chains.

## What was omitted

- Comment checker: `SKIPPED-no-binary`.
- Darwin lacks the driver's directory-identity primitive:
  `DIRECTORY_IDENTITY_UNAVAILABLE`. Consequently `isolationCertified`,
  `realHomeIsolationCertified`, `realSenpiUntouched`, and `realOmoUntouched`
  are false. This is not a claim of complete home isolation or proof that
  the homes changed: protected snapshots were complete and unchanged, but
  broad directory observation could not certify them.
- No live remote model inference, credential dump, or capability snapshot
  regeneration.
