export const END_ULTRAWORK_TEMPLATE = `Deactivate ultrawork mode for the current session.

This command will:
1. Remove the <ultrawork-mode> rules block from the active context
2. Restore default Matrixx behavior (no enforced certainty protocol, no mandatory plan agent, no required acceptance criteria)
3. Stop ultrawork-specific parallel delegation pressure

After running this command:
- The session continues with normal Matrixx rules
- Existing todos and plans remain unchanged
- Already-spawned background tasks continue to completion
- The deactivation is per-session and clears when the session ends

Use this when you want to exit ultrawork mode explicitly and return to standard behavior. Useful for sub-tasks that should not inherit ultrawork rules, or when switching from heavy-execution to lighter reasoning.`
