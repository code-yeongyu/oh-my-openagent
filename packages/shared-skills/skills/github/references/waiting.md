# Waiting for CI and workflow runs

**SUBSCRIBE TO THE END STATE AND KEEP WORKING.** Never use `gh pr checks --watch`, `gh run watch`, a `while sleep` loop, one fixed sleep followed by a single check, or repeated `pr.checks` calls. Each of those either holds a foreground tool call or guesses when CI ends.

## Pick the shape by how long the wait can run

**Under about 4 minutes: await it in the eval cell.**

```js
const res = await client.pr.wait({ repo: "o/n", number: 42, headSha, timeoutMinutes: 4 })
```

A cell is killed at 300 s of its own execution, so keep `timeoutMinutes` at 4 or less. Past about 30 s the cell detaches and its result arrives as a notification.

**Longer (full CI, release workflows): a command monitor.** The command writes the JSON to a file and prints one sentinel line. That line is the event that wakes you. Replace `<skill-root>` with this skill's own directory, as in SKILL.md; the result file goes in a fresh temp directory.

```js
const { mkdtemp } = await import("node:fs/promises")
const { tmpdir } = await import("node:os")
const out = `${await mkdtemp(`${tmpdir()}/pr-42-wait-`)}/result.json`
await tool.monitor({
  description: "PR 42 checks settle",
  command: `bun "<skill-root>/scripts/cli.ts" pr wait --repo o/n --number 42 --head-sha ${headSha} --timeout-minutes 90 > "${out}"; ` +
    `printf 'CI_SETTLED %s\\n' "$(bun -e 'console.log((await Bun.file(process.argv.at(-1)).json()).verdict)' "${out}")"`,
  filter: "^CI_SETTLED ",
  timeout_ms: 100 * 60_000,
})
```

- **SET `timeout_ms` ABOVE `--timeout-minutes`.** The monitor's deadline kills the command, and a killed wait reports nothing. A wait that times out by itself still writes its evidence.
- Keep working on whatever does not depend on the result. When `CI_SETTLED <verdict>` arrives, read the file for `failing` (name, state, `runId`, url), `pending` and `headSha`.
- For a run id, use `cli.ts run wait --repo o/n --run-id <id>` with the same sentinel. It returns `verdict`, `run` and `failedJobs` with their failed steps.
- A wait that must survive a session restart takes `persistent: true`.

**From an MCP client:** `pr_wait` and `run_wait` block for the whole wait, so give the call a timeout above `timeoutMinutes`.

## Inputs that decide the result

- **PASS `headSha` WHENEVER THE WAIT GUARDS A MERGE.** Take it from the `pr.view` you verified, or from `git rev-parse HEAD` right after your own push. A fresh push takes a few seconds to show on the PR, so a mismatch counts as still starting for `graceSeconds` (default 120). A head that still differs after that returns `head_moved`, instead of green checks for a commit you never looked at.
- **RUN ONE WAIT PER PR AT A TIME.** Each `pr.wait` poll is one GraphQL call against a shared budget.
- Defaults: poll every 30 s (minimum 10), `timeoutMinutes` 60, and `failFast` true because one red check already decides a merge. Zero checks count as still starting for `graceSeconds`, then return `no_checks`.
- `run.wait` needs a run id. Get it from `pr.checks[].runId`, or from `run.list` after a `run.dispatch`.

## After the verdict

| Verdict | Next step |
|---|---|
| `pass` | `pr.merge({ matchHeadSha: res.headSha })`. A head that moved since then refuses with kind `conflict`. |
| `fail` | `run.logs({ runId: res.failing[i].runId, grep: "##\\[error\\]" })` shows the cause. Fix it at the root, push, then arm a new wait on the new head. |
| `head_moved` | Someone pushed. Re-read `pr.view`, verify again, and wait on the new `headSha`. |
| `no_checks` | **DO NOT MERGE ON AN EMPTY ROLLUP.** Check that the workflows trigger for this branch or event with `run.list({ sha })`. |
| `timeout` | Read `pending` to see which checks hang, then `run.view` them. **DO NOT RE-TRIGGER CI** to make it move: no label toggles, no close/reopen, no empty commits. |
