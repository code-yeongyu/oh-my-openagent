# codex-ulw-execute-continuation

Codex Stop-hook continuation injector for the omo-codex `ulw-execute` skill.

It reads `.omo/boulder.json` in the hook payload `cwd`, resolves the active work, inspects the active plan's top-level checklist, and emits Codex Stop-hook JSON while the plan still has unchecked tasks or its final review/debugging gate remains pending:

```json
{"decision":"block","reason":"<directive>"}
```

The `reason` is loaded from `directive.md` on every invocation and filled with current plan state. The hook returns no output when `stop_hook_active` is `true`, when `last_assistant_message` starts with `<ulw-execute-blocked-external>` (or places it immediately after the mandatory `ULTRAWORK MODE ENABLED!` opener), when no active Boulder work exists, when the work is completed, when the active work is not tied to `codex:<session_id>`, or when the plan has no readable top-level checklist. An active plan whose checklist is fully checked still blocks Stop until the final gate runs and Boulder is marked completed.

## External blocker escape hatch

A plan can stall on something no amount of retrying fixes: a missing credential, missing hardware, a revoked authorization, an unavailable third-party service. `directive.md` instructs the agent to write `<ulw-execute-blocked-external>` as the entire first line of its answer in that case, or as the entire second line when ultrawork's mandatory opener occupies the first. The hook recognizes those structural forms and lets the turn end so the user can act, instead of continuing the same unchanged external-state check forever. Merely discussing the marker later in an answer still continues the plan.

This pairs with the `ulw-execute` skill at `plugin/skills/ulw-execute/SKILL.md`. That skill writes `.omo/boulder.json` with Codex session ids prefixed as `codex:` so the hook can continue only its own active Codex session.

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
