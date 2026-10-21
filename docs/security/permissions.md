# Per-tool permissions

omo ships a per-tool permission profile that runs in the ToolGuard hook tier
on every `tool.execute.before`. The gate is **always on**. Every tool call
goes through it; you can change the answer with config or session-scoped
overrides, but you cannot turn the gate itself off.

## Schema

Add a `tools.<name>.permission` block to `omo.json` (top level or inside the
`[opencode]` block). Each value is one of `allow`, `ask`, `deny`.

```jsonc
{
  "tools": {
    "bash":   { "permission": "ask" },
    "edit":   { "permission": "ask" },
    "write":  { "permission": "ask" },
    "read":   { "permission": "allow" },
    "grep":   { "permission": "allow" },
    "glob":   { "permission": "allow" },
    "webfetch": { "permission": "deny" },
    "session_overrides": {}
  }
}
```

The cross-harness Zod schema is the same shape as
`OmoToolPermissionLayerSchema` in `@oh-my-opencode/omo-config-core`; sibling
adapters read the same key for autocomplete parity even though only the
opencode plugin wires the gate today.

### Per-agent profile

You can scope a tool's permission to a single agent. Add it under
`agents.<name>.tools.<tool>.permission`:

```jsonc
{
  "agents": {
    "prometheus": {
      "tools": {
        "read": { "permission": "ask" },
        "write": { "permission": "deny" }
      }
    }
  }
}
```

Per-agent overrides win above the global `tools.<name>.permission`.

## Resolution order

When the gate sees a call, it resolves a single decision in this order
(highest priority first):

1. **Session-cached `ask` decision.** A previous call for the same
   `(sessionID, tool, target-path)` triple resolved to `ask`. The next call
   for that triple resolves to `allow`. This is what makes the cost one
   decision per session per pair rather than one per call.
2. **Explicit user override.** A `tools.session_overrides` entry in the
   opencode plugin config, keyed by
   `<sessionID>\0<tool>\0<target>` and valued `allow` / `ask` / `deny`.
   A stored `deny` is never replaced by a later `allow` for the same key.
3. **Per-tool config override.** `tools.<name>.permission` at the top of
   `omo.json` or inside the `[opencode]` block.
4. **Per-agent profile.** `agents.<name>.tools.<tool>.permission`.
5. **Built-in defaults.** `allow` for read-only tools (`read`, `glob`,
   `grep`, `session_list`, `session_read`, `session_search`, `session_info`)
   and `ask` for everything else, including any tool a future version adds
   that this set has never heard of.

## Behavior

| Decision | What the gate does |
|----------|--------------------|
| `allow`  | Tool runs. A default-allow call writes no audit entry; an allow that came from an override or the session cache writes one, so a reviewer can see why a normally-asked tool was permitted. |
| `ask`    | The first call for this `(session, tool, target-path)` records the decision so every later call for the same triple resolves to `allow`. The call itself runs. A confirmation prompt is not part of this version; the decision is recorded and auditable. One audit entry per `ask`. |
| `deny`   | The tool is refused with a synthetic error naming the tool. One audit entry records the denial. |

### User-facing cost

The behavior change is that `bash`, `edit`, and `write` now default to `ask`
rather than running silently. The cost is **one decision per session per
`(tool, target-path)` pair, not one per call**: the same target used five
times in a session costs one, not five. A different target is a different
pair and costs its own decision, and so is the same target on a different
tool.

To remove the cost entirely:

- Set `tools.bash.permission` (and `write`/`edit`) to `"allow"`.
- Or scope it to one agent with
  `agents.<name>.tools.<tool>.permission`.

A `deny` costs a refused call and no decision.

## Audit log

Every non-default decision lands in an append-only JSONL file:

```
~/.omo/audit/<YYYY-MM-DD>/<sessionID>.jsonl
```

Each line is one entry:

```json
{
  "ts": "2026-10-21T18:42:11.123Z",
  "tool": "bash",
  "targetPath": "rm -rf /",
  "sessionID": "ses_abc",
  "decision": "deny",
  "source": "tools_override"
}
```

The directory and the file are created with mode `0o700` and `0o600`
respectively (best-effort; ignored on Windows). A failure to write an
audit entry is reported on stderr and never fails the tool call: losing an
audit line is bad, but losing the agent's work because the disk is full is
worse. The log lives under `~/.omo/`, so it is not shipped, not synced, and
never added to a remote.

## Adding new tool categories

The read-only allow set lives in
`packages/omo-opencode/src/hooks/permission-gate/resolve.ts` as
`READ_ONLY_TOOLS`. A new built-in tool that only reads belongs there; a new
mutating tool needs no entry, because everything not in `READ_ONLY_TOOLS`
already defaults to `ask`. The gate's factory tests in `permission-gate.test.ts`
pin the membership of that one set.
