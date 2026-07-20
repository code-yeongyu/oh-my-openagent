# codex-start-work-continuation

Codex Stop-hook continuation injector for the omo-codex `start-work` skill.

It reads `.omo/boulder.json` in the hook payload `cwd`, resolves the active work, inspects the active plan's top-level checklist, and emits Codex Stop-hook JSON while the plan still has unchecked tasks or its final review/debugging gate remains pending:

```json
{"decision":"block","reason":"<directive>"}
```

The `reason` is loaded from `directive.md` on every invocation and filled with current plan state. The hook returns no output when `stop_hook_active` is `true`, when no active Boulder work exists, when the work is completed, when the active work is not tied to `codex:<session_id>`, or when the plan has no readable top-level checklist. An active plan whose checklist is fully checked still blocks Stop until the final gate runs and Boulder is marked completed.

This pairs with the `start-work` skill at `plugin/skills/start-work/SKILL.md`. That skill writes `.omo/boulder.json` with Codex session ids prefixed as `codex:` so the hook can continue only its own active Codex session.

## ULW Loop resume snapshots

When an active `ulw-loop` run has a resume snapshot, the continuation hook may read `.omo/ulw-loop/<session-id>/snapshots/latest.md` under the active workspace and include its next action in the continuation directive. This gives a new Codex turn a minimal handoff after transcript context has been discarded.

Snapshot lookup is deliberately limited. The hook only accepts a bounded markdown snapshot with the expected sections, a matching session id when present, and metadata paths that stay inside the workspace. Missing, malformed, oversized, out-of-workspace, or unsafe snapshots are ignored.

Resume snapshots are data-minimized. They are intended to contain status summaries, short redacted evidence excerpts, changed-file summaries, and one next action. They must not be treated as raw transcripts or as storage for headers, cookies, API keys, patches, diffs, or captured evidence payloads.

This is separate from `codex resume`. `codex resume` restores Codex conversation history; the snapshot bridge only gives the Stop hook enough local state to point at the next `ulw-loop` action when conversation history is not available.

## Counted plan checkboxes

Only column-0 checkboxes under these sections are counted:

- `## TODOs`
- `## Final Verification Wave`

Nested checkboxes under `### Acceptance Criteria`, `### Evidence`, and `### Definition of Done` are ignored.

## Smoke test

```bash
TMP=$(mktemp -d)
mkdir -p "$TMP/.omo/plans"
cat > "$TMP/.omo/plans/test.md" <<EOF
## TODOs
- [ ] Task one
- [ ] Task two
EOF
cat > "$TMP/.omo/boulder.json" <<EOF
{"schema_version":2,"active_work_id":"w1","works":{"w1":{"work_id":"w1","active_plan":".omo/plans/test.md","plan_name":"test","session_ids":["codex:smoke-session"],"status":"active"}}}
EOF
PAYLOAD='{"session_id":"smoke-session","turn_id":"t1","transcript_path":"","cwd":"'"$TMP"'","hook_event_name":"Stop","model":"gpt-5.5","permission_mode":"default","stop_hook_active":false}'
npm run build
echo "$PAYLOAD" | node dist/cli.js hook stop

PAYLOAD_LOOP='{"session_id":"smoke-session","turn_id":"t1","transcript_path":"","cwd":"'"$TMP"'","hook_event_name":"Stop","model":"gpt-5.5","permission_mode":"default","stop_hook_active":true}'
echo "$PAYLOAD_LOOP" | node dist/cli.js hook stop

rm -rf "$TMP"
```

Expect the first command to print JSON containing `"decision":"block"`; expect the anti-loop command to print nothing.

## License

MIT. See `LICENSE`.

## Privacy

This plugin only reads local hook payloads, `.omo/boulder.json`, the active plan, and the bundled directive. It makes no network calls and stores no telemetry.
