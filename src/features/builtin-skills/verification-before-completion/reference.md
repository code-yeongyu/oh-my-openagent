# Reference: verification-before-completion

## Quick Checklist

- ✅ Acceptance criteria satisfied
- ✅ Tests green (no skips)
- ✅ Linters clean
- ✅ No stray debug logs
- ✅ TODOs addressed or documented
- ✅ Docs updated if needed
- ✅ Clean git status

## Red Flags

🚩 Skipped tests (temporary disable that became permanent)
🚩 `console.log` or `print` statements for debugging
🚩 `TODO`, `FIXME`, `HACK` without tracking
🚩 Commented-out code blocks
🚩 Uncommitted changes

## When Codex Was Involved

If Codex contributed to the implementation:

1. **Summarize contributions**: What did Codex help with?
2. **Note unverified areas**: Any suggestions not fully tested?
3. **Track in metadata**: Include in archive `metadata.json`

## Integration with Archive

Before archiving:

1. Run full verification checklist
2. Generate verification report
3. Include in archive metadata
4. Tag Git commit

## Escalation

If verification fails:
- Minor issues: Fix immediately, re-verify
- Major issues: Return to implementation, update task status
- Blocking issues: Escalate to user, document in gap log
