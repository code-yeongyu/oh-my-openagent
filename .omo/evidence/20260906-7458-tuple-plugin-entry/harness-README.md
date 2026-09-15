# Issue 7458 — real-OpenCode harness QA (session.created hook)

Addresses the P1 review request on PR #7823: prove the fix against real OpenCode
via the session.created lifecycle hook, in an isolated sandbox, with evidence.

## Method
`harness-qa.sh` drives the REAL `opencode serve` (v1.18.29) in an isolated XDG
sandbox (own XDG_DATA/CONFIG/CACHE/STATE_HOME + HOME under a mktemp dir, offline
flags set). The project's `.opencode/opencode.json` plugin array is:

    [ ["opencode-auto-resume@1.1.10", { ... }],   # tuple-style entry (the bug trigger)
      "oh-my-openagent@4.19.4",                    # the pinned entry that must be found
      "file://<probe.js>" ]                        # a tiny real OpenCode plugin

`probe.js` is a minimal real OpenCode plugin whose `event` hook, on
`session.created`, calls the two functions the PR changes —
`findPluginEntry(directory)` and `isLocalDevMode(directory)` — and writes the
result to disk. It is bundled twice from source: GREEN from the PR head, RED from
the pre-fix base commit b0e142ddb. This runs the exact fixed code path inside
OpenCode's real session.created hook without needing the full plugin asset tree.

A session is created over HTTP (`POST /session`), which fires `session.created`;
the harness waits for the probe to write its decision, then shuts the server down
gracefully and compares the real DB session count before and after.

## Result (identical opencode 1.18.29, identical config, identical sandbox)
| variant | source | probe hook fired | findPluginEntry | real DB sessions |
|---------|--------|------------------|-----------------|------------------|
| RED  | base b0e142ddb (pre-fix) | yes | `null` | 8077 -> 8077 |
| GREEN | PR head c5040ad (fix) | yes | `{ entry: "oh-my-openagent@4.19.4", isPinned: true, pinnedVersion: "4.19.4" }` | 8077 -> 8077 |

Full captures: `harness-red.txt`, `harness-green.txt`.

## Why this is enough
The decision flips at the exact function seam the PR changes, exercised by
OpenCode's real `session.created` hook (`probe_hook_fired_on_session_created:
yes` in both runs): before the fix a preceding tuple entry makes
`findPluginEntry` return `null` (the pinned omo entry is silently lost); after the
fix it is found. OpenCode accepted the tuple-style plugin array in both runs
(`serve_plugin_notes: none`). Isolation is proven by the unchanged real
`~/.local/share/opencode/opencode.db` session count (8077 before and after each
run); the sandbox is torn down on exit.

## Isolation and scope note
The probe deliberately loads only the two changed modules, so the run needs no
network, no models, and no materialized plugin assets. The full auto-update-checker
orchestration around these functions is unchanged by this PR and is covered by the
unit suite (36 pass in the checker dir, 84 pass in the wider scope) and the
`get-local-version` CLI before/after (`cli-red.txt` / `cli-green.txt`).

## What was omitted
No credentials, tokens, or private configuration. Fixtures use a synthetic plugin
list. Temp bundles under /tmp and the base worktree were removed after the runs.


## SSE wire capture (session.created)
`harness-sse.sh` attaches the real `GET /event` SSE stream of the isolated
sandbox server, triggers a session, and captures the raw stream. Result
(`harness-sse-green.txt`, raw in `sse-raw-green.txt`):

- `session_created_on_sse_wire: yes`
- `sse_event_type_histogram: 1 "type":"session.created"; 1 "type":"server.connected";`
- `session_created_line: data: {"type":"session.created","properties":{"sessionID":"ses_…"}}`
- probe decision on the same hook: `findPluginEntry = { entry: "oh-my-openagent@4.19.4", isPinned: true, pinnedVersion: "4.19.4" }`
- real `opencode.db` session count unchanged: 8077 -> 8077

This proves `session.created` reached the SSE wire (per the AGENTS.md
sse-hook-probe mandate) in the same isolated run that records the fixed
function's decision. The earlier empty `sse_session_event_types` field was a
harness capture bug (stream grep timing), not a plugin defect; the raw-stream
capture here shows the event verbatim.
