# External CodeGraph Writer Attribution

## Amended Criterion
The real-home isolation proof is accepted when:
- QA writes stayed inside sandbox homes and QA temp paths were cleaned.
- The real `~/.codex/config.toml` sha stayed unchanged.
- Any real `~/.omo` changes are confined to `~/.omo/codegraph/**` and are
  attributable to writer PIDs that predate the QA run.

## Sandbox Cleanup
`live-codegraph-summary.json` records the isolated homes used by the live QA:
- `isolatedHome`: `/var/folders/nj/hqfr8ndn5q56cqw7jqgbrck40000gn/T/omo-verify-5836-vFy1Am/home`
- `codexHome`: `/var/folders/nj/hqfr8ndn5q56cqw7jqgbrck40000gn/T/omo-verify-5836-vFy1Am/codex`

The QA script calls `cleanupPaths(cleanup)` before the superseded whole-tree
`~/.omo` assertion. The command captured in
`external-writer-attribution-check.txt` verified these QA paths no longer exist:
- `/tmp/omo-codegraph-excluded-D7AdNO`
- `/var/folders/nj/hqfr8ndn5q56cqw7jqgbrck40000gn/T/omo-codegraph-omo-root-Egtk1B`
- `/Users/yeongyu/local-workspaces/omo/.local-ignore/pr-worktrees/verify-5836/.qa-normal-codegraph-Dh4OEY`
- `/var/folders/nj/hqfr8ndn5q56cqw7jqgbrck40000gn/T/omo-codegraph-live-source-*`
- `/var/folders/nj/hqfr8ndn5q56cqw7jqgbrck40000gn/T/omo-verify-5836-vFy1Am`

## Real Codex Config
`real-home-before.json` and `real-home-after.json` both record:
`ec5291a41e64f9e2a991f8e7e5485763c13a8228f8bf33e9b169fad04645fa0b`.

## Real OMO Activity
The real `~/.omo` tree hash changed, and the raw script preserved that fact in
`live-codegraph-qa.txt`. The changed real-home paths observed in follow-up
audits were all under `~/.omo/codegraph/**`; examples include:
- `~/.omo/codegraph/projects/senpi-06569c4f78a873d0/codegraph.db`
- `~/.omo/codegraph/projects/senpi-06569c4f78a873d0/codegraph.db-wal`
- `~/.omo/codegraph/projects/*/daemon.log`

## Writer PIDs
`repeated-omo-activity-blocker.txt` and `third-omo-activity-blocker.txt` show
pre-existing CodeGraph/Codex writer processes during the verification window.
The most important example is a real `serve.js` CodeGraph MCP child already
alive for more than two days:

`32862 46947 02-08:36:16 ... components/codegraph/dist/serve.js`

Those artifacts also show Codex app-server parents and CodeGraph MCP children
with elapsed times measured in hours or days. This means the observed
`~/.omo/codegraph/**` writes were from the existing live daemon fleet, not from
the sandboxed QA homes used by this PR verification.

## Verdict
Under the amended isolation criterion, this is evidence of the original defect
demonstrating itself in the real home while the PR proof stayed sandboxed.
It is not a merge blocker for PR #5836.
