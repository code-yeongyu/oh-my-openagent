# Epic: LIF-65 (UPDATE EXISTING)

**Action**: UPDATE existing parent issue LIF-65 (do NOT create new epic)

## Updated Description

Unify 35+ commands under shared workflow contract with consistent Linear integration and quality commands.

## Summary (for Linear)

Command ecosystem has fragmented patterns: /specify requires Linear, /plan ignores it, governance tools unused, no /review or /test commands. This creates WorkflowContext + commandPreflight() shared by all workflow commands.

## Success Metrics

- All workflow commands use shared WorkflowContext
- Single Linear policy (off|optional|required) across commands
- /review and /test commands exist
- Workflow state survives session restart
- /help shows organized categories

## Labels

- `type:feature`
- `priority:high`
