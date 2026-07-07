# W3-V blocking defect: full team scenario driven end-to-end live

Closes the single W3-V blocking defect: "Full W3 team scenario not driven end-to-end; only baseline
team_create+task proven live." The extended team-drive harness now drives the whole lead team-tool
chain on the real senpi binary in an isolated sandbox, and every tool is asserted at the
tool_execution_end boundary.

## WHAT WAS TESTED

- Surface driven: the real `senpi` binary (`/opt/homebrew/bin/senpi`, `@code-yeongyu/senpi`
  `2026.7.5-2`) in `-p` non-interactive mode, loading ONLY our omo-senpi plugin, against a LOCAL
  in-process mock provider (`omo-mock/mock-1`, no network / no real model call).
- Isolation: a throwaway `SENPI_CODING_AGENT_DIR` sandbox (from the committed `createSandbox` /
  `seedSandbox` helpers in `packages/omo-senpi/scripts/qa/drive.mjs`, reused UNCHANGED). The real
  `~/.senpi/agent` is sha256-digested before and after and asserted identical.
- Command: `node harness/team-drive.mjs` (a /tmp copy at run time; archived here). The lead mock script
  drives, in canonical order, the full lead team-tool chain in ONE senpi session:
  `team_create` (inline 2-member category spec) -> `team_status` -> `team_send_message` (lead->member)
  -> `team_task_create` -> `team_task_list` -> `team_shutdown_request` -> `team_approve_shutdown` ->
  `team_delete` -> final text.
- Adaptive `team_run_id`: `team_create` mints the run id at runtime, so the lead chain scripts a
  `__TEAM_RUN_ID__` placeholder and the mock substitutes the real id read back from the `team_create`
  tool result content text, keyed on `toolName` (`harness/mock-provider.index.ts` `selectMockStep` /
  `extractTeamRunId`). Lead turn sequencing is content-keyed on the count of prior tool results (NOT a
  call counter) so an interleaved in-process member turn cannot desync it.
- The two harness files (extended mock provider + drive) each ship a `--self-test`; the committed
  originals under `packages/omo-senpi/scripts/qa/` were NOT edited.

## WHAT WAS OBSERVED

- `team-drive-result.json`: `result: PASS`, `status: 0`.
- Per-tool `tool_execution_end` (`lead-toolresults.jsonl`, raw from the lead session transcript). Every
  one of the 8 lead team tools returned `isError: false` with the expected happy-path `details.kind`:
  - `team_create` -> `created`, `Created team 'w3-drive' (<uuid>) with 2 members.`
  - `team_status` -> `status`, `Team 'w3-drive' is active with 2 members.` (2 member views, each with a
    real child `session_id`)
  - `team_send_message` (lead->member) -> `to_members`, `Delivered to 1 member(s).`
    (`deliveries: [{member: researcher, outcome: revived}]`, a real mailbox delivery decision + message id)
  - `team_task_create` -> `created`, `Created task 1.`
  - `team_task_list` -> `list`, `1 task(s).`
  - `team_shutdown_request` -> `requested`, `Requested shutdown for 'researcher'.`
  - `team_approve_shutdown` -> `approved`, `Approved shutdown for 'researcher'.`
  - `team_delete` -> `deleted`, `Deleted team <uuid>; cancelled 0 member tasks.`
- `teamRunId` minted and threaded through every downstream tool (`ce06faa0-...` / `a41be621-...`).
- Zero TypeBox schema rejections: no errored tool result anywhere, and no schema-rejection text in the
  transcript or stderr (`drive-stderr-error-scan.txt`; only unrelated ulw-loop status noise).
- Runtime-dir cleanup: after `team_delete`, the team-core runtime dir keyed to the run id is gone
  (`runtimeDirCleanedUp: true`; the `teams/runtime/` root was observed empty post-run).
- Isolation proof: `realSenpiUntouched: true` (`~/.senpi/agent` sha256 identical before/after).

## WHY IT IS ENOUGH

- The primary gap was that only `team_create` + `task` had been proven live; the extended 7+1-step lead
  chain now runs on the real harness with a per-tool `isError:false` + happy-path-`kind` assertion at the
  actual tool_execution_end boundary, plus run-id threading, no-schema-rejection, runtime-dir cleanup,
  and real-`~/.senpi`-untouched isolation. That covers the tools the W3-V report flagged NOT VERIFIED
  LIVE: `team_status`, `team_send_message` lead->member steer, `team_task_create`/`list`,
  `team_shutdown_request`/`approve`, `team_delete`, and runtime-dir cleanup.
- The full family is additionally green in the hermetic unit suites
  (`bun test packages/senpi-task packages/omo-senpi`), so this live drive is the end-to-end confirmation
  on top of unit coverage.

## WHAT WAS OMITTED / LIMITATIONS

- Member->lead surfacing (a member's own model turn calling its scoped `team_send_message`) is NOT driven
  live here and is reported as `memberLeadSurfacing: harness-limited-covered-by-unit-tests`. Root cause:
  an in-process member child builds its agent session against a model registry that does NOT inherit the
  `-e`-registered custom-`streamSimple` mock provider, so the member resolves `omo-mock/mock-1` as an
  unknown provider and errors with "No API key found" before any model turn (seeding `auth.json` does not
  help, because the model itself is unknown to the child registry). Members therefore show
  `status: errored` in `team_status` even though the lead-side spawn, roster, delivery, and lifecycle
  tools all execute correctly. The reverse member->lead delivery path is covered by the senpi-task
  team-messaging unit tests. Driving it live would require a disk-configured HTTP mock provider that
  children can resolve, which is out of scope for this fix.
- No secrets/tokens/auth headers are present in these artifacts. `drive-stderr-error-scan.txt` is a
  filtered error-only scan of stderr (the full stderr contained only benign ulw-loop status noise).
