# Evidence: authentic production reproduction (real OpenCode user session)

Date: 2026-08-04
PR: https://github.com/code-yeongyu/oh-my-openagent/pull/6583
Issue: https://github.com/code-yeongyu/oh-my-openagent/issues/6582
Related: `README.md` in this dir (synthetic real-harness QA), `./../keysun-tax-submission-reliability/TOOL-BUG-FINDINGS.md` (original incident write-up)

## The authentic fault happened here

The `got undefined` failure that this whole PR fixes was NOT a manufactured repro. It
occurred live in a real OpenCode user session, recorded in the production OpenCode DB.

- **Session:** `ses_038a0d10dffe7hHQyjy3ndVIgF`
  (2026-08-03, 494 messages, agents `openproject-updater`, `Sisyphus - ultraworker`, `code`, `Prometheus - Plan Builder`, `Atlas - Plan Executor`, `compaction`)
- **Model stack:** heavy `9router` (`5.6 terra`) - the model actually driving tool calls
- **Agent:** `Atlas` (from `oh-my-openagent`), running under `$start-work` plan execution
- **Repro evidence source:** production `~/.local/share/opencode/opencode.db`, `part` table rows for the session containing `got undefined`
- **Observed broken tools:** `edit` and `task` - identical error every invocation
- **Observed working tools:** `read`, `write`, `bash`, glob/grep, `lsp_*`, `envsitter_*`
- **Timestamps of failing events (ms epoch -> UTC):**
  - `1785791986035` `edit` -> `{"status":"error", "input":{"filePath":".../FakeAppSettings.cs", ...oldString: "...undefined"}}`
  - `1785792261985` `edit` `/tmp/edit_probe.txt` -> `{"status":"error", "error":"The \"path\" property must be of type string, got undefined"}`
  - `1785791698122`+ `task` (multi-param) -> `{"status":"error", "input":{...}, "error":"The \"path\" property must be of type string, got undefined"}`
  - `1785795757766` `edit` `/tmp/edit_probe.txt` minimal args -> same `"got undefined"` error

The in-session diagnosis (failing agent's own bash transcript, verbatim command):
```bash
grep -n "got undefined\|got object\|required error\|AggregateError\|must be of type string" \
  /home/allmaker/.cache/opencode/packages/oh-my-openagent@latest/node_modules/oh-my-openagent/dist/index.js
# => 11453: return message.includes('The "path" property must be of type string') && message.includes("got object");
```

## Root cause - reproduced on the exact installed artifact

The installed plugin was `oh-my-openagent@latest` **v4.19.4**, bundled
`dist/index.js:11453`:

```js
function isObjectPathTypeError(error) {
  const message = ...;
  return message.includes('The "path" property must be of type string') && message.includes("got object");
}
```

This guard drives `dispatchWithPathCompatibility`: on a `path` schema TypeError it only
retries when the message says `got object` (the object-form `session.promptAsync({path:{id}})`).
But the real harness produced `got undefined` (session path undefined at dispatch), so the
guard did not retry, `dispatchWithPathCompatibility` re-threw, and the raw error surfaced to
the user as a broken `edit`/`task`. This is the exact mismatch this PR fixes.

**Verified independently on this QA host** against the same installed plugin artifact:
`/home/allmaker/.cache/opencode/packages/oh-my-openagent@latest/node_modules/oh-my-openagent/dist/index.js:11453`
still contains only `message.includes("got object")` - the pre-fix bug.

## Why this beats a synthetic repro

- It is **observed behavior in the real harness**: real model (`5.6 terra`), real agent
  (`Atlas` from this same plugin), real session `path` lifecycle that produced the
  `got undefined` variant - precisely the SDK/server + plugin path unit mocks cannot cover.
- It pinpoints the exact installed artifact and line; the fix (`got object` **OR**
  `got undefined`) is the minimal change that makes `dispatchWithPathCompatibility` retry
  this real production error shape.
- Paired with `README.md` synthetic harness run (fresh install + real OpenCode CLI driving
  `edit` cleanly) and the unit tests (below), it forms reproduction -> root-cause -> fix ->
  regression coverage.

## Regression coverage
```bash
$ bun test src/prompt-async-gate-path-compat.test.ts  # packages/utils
3 pass, 0 fail, 6 expect() calls
```
The new cases assert `isObjectPathTypeError` accepts the exact production message string
`The "path" property must be of type string, got undefined`.

## Provenance
Session part rows for `ses_038a0d10dffe7hHQyjy3ndVIgF` were read from the production
OpenCode DB via `SELECT ... FROM part WHERE session_id=? AND data LIKE '%got undefined%'`.
The failing `edit` on `/tmp/edit_probe.txt` is minimal and self-contained; it failed with
`got undefined` even though the file existed - proving the failure is in plugin dispatch,
not in the edit content/schema.
