# PR 5836 Verification Summary

Verdict: PASS under the amended isolation criterion; ready to commit, push, wait
for required checks, and merge.

## What Was Tested
- Merged current `origin/dev` into `verify/pr-5836`.
- Merged the later `origin/dev` advance again after continuation.
- Ran `bun run test:codex`, then reran it after the latest `origin/dev` merge.
- Ran `bun run typecheck`; first attempt failed after the first dev merge because dependencies for newly merged `packages/omo-senpi` were not installed, then `bun install --ignore-scripts` and the reruns passed.
- Ran `bun test packages/utils packages/omo-codex`, then reran it after the latest `origin/dev` merge.
- Drove live Codex app-server sessions from:
  - a `/tmp` cwd,
  - a cwd containing a `.omo` segment,
  - a normal non-excluded cwd.
- Probed the CodeGraph SessionStart skip decision, worker inclusion path, child env, MCP serve env, dead-store GC, and real-home isolation.

## What Was Observed
- Dev merges completed cleanly: `merge-origin-dev.txt`,
  `merge-origin-dev-latest.txt`.
- `bun run test:codex` passed before and after the latest dev merge:
  `test-codex.txt`, `test-codex-after-latest-dev.txt`.
- `bun test packages/utils packages/omo-codex` passed before and after the
  latest dev merge: `bun-test-utils-omo-codex.txt`,
  `bun-test-utils-omo-codex-after-latest-dev.txt`.
- `bun run typecheck` reruns passed after dependency refresh and after the
  latest dev merge: `typecheck-rerun-after-install.txt`,
  `typecheck-after-latest-dev.txt`.
- `/tmp` and `.omo` SessionStart probes returned `{"action":"skipped-excluded","exitCode":0}`: `direct-skip-tmp.json`, `direct-skip-omo.json`.
- Live app-server hook wiring completed for excluded and normal cwd scenarios: `app-server-tmp-excluded.json`, `app-server-omo-excluded.json`, `app-server-normal-included.json`.
- Excluded cwd scenarios created no fake CodeGraph child invocations and no project store metadata: `live-codegraph-summary.json`.
- Normal worker path invoked fake CodeGraph and recorded source metadata: `fake-codegraph-invocations.jsonl`, `worker-normal-included.json`, `live-codegraph-summary.json`.
- Worker and serve child env included `CODEGRAPH_NO_DAEMON=1`: `fake-codegraph-invocations.jsonl`, `serve-env.json`.
- Dead `source.json` store was pruned and live store survived: `live-codegraph-summary.json`.
- Real `~/.codex/config.toml` hash was unchanged: `real-home-before.json`, `real-home-after.json`.
- Real `~/.omo` hash changed during the run, but every observed changed path
  was confined to `~/.omo/codegraph/**` and attributable to pre-existing
  external CodeGraph daemons: `real-home-before.json`, `real-home-after.json`,
  `live-codegraph-qa.txt`, `external-writer-attribution.md`.

## Isolation Verdict
The original live script asserted that the entire real `~/.omo` tree hash must
remain unchanged, and `live-codegraph-qa.txt` therefore exits with
`real ~/.omo changed`. The amended review criterion treats concurrent writes by
pre-existing external CodeGraph daemons as out of scope because they are the
defect this PR is designed to stop for newly launched children.

Under the amended criterion, isolation is proven:
- QA writes stayed inside the sandbox homes and the QA temp paths were cleaned:
  `live-codegraph-summary.json`, `external-writer-attribution.md`.
- Real `~/.codex/config.toml` sha stayed unchanged:
  `real-home-before.json`, `real-home-after.json`.
- Observed real `~/.omo` activity was confined to `~/.omo/codegraph/**`, with
  CodeGraph/Codex writer processes that already existed before the QA window:
  `repeated-omo-activity-blocker.txt`, `third-omo-activity-blocker.txt`,
  `external-writer-attribution.md`.

## External-Writer Attribution
The two continuation audits show the same live daemon fleet repeatedly writing
under `~/.omo/codegraph/**` after the QA run. Representative writer evidence:
`repeated-omo-activity-blocker.txt` records live `serve.js` / CodeGraph MCP
processes, including a `serve.js` process already alive for `02-08:36:16`, and
only recent real-home file activity under `~/.omo/codegraph/projects/...`.
`third-omo-activity-blocker.txt` repeats the same pattern on the next audit.

No CodeGraph process was killed or restarted during this attribution check.

## What Was Omitted
- No GitHub comments were posted.
- Raw secret-bearing logs and full process environments were not copied;
  evidence keeps only relevant CodeGraph env keys and process command lines.
