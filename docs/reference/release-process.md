# Release Process Reference

This reference captures release gates that are easy to miss during urgent fixes.

## Post-Fix Repro Verification

For race-condition and concurrency fixes, CI green is necessary but not
sufficient.

Before closing the source issue, the original issue reporter must re-run the
documented reproducer against the fix commit. If the reporter is unavailable, a
maintainer must run the same reproducer in an equivalent environment.

This policy applies to bugs involving:

- duplicate streaming output
- repeated internal prompt injection
- session recovery races
- background task wake races
- runtime fallback retry races
- team mailbox delivery races
- test contamination caused by shared mocks or module state

### Required checklist

- Record the issue number and fix commit hash.
- Confirm the reproducer is documented in the issue or PR.
- Build or install the exact fix commit under test.
- Run the reproducer without local patches.
- Capture the command, input prompt, config, provider, model, and platform.
- Confirm the original failure is absent.
- Confirm no new adjacent failure appears in logs or terminal output.
- Link the successful repro result before closing the issue.

### Reporter path

1. Ask the original reporter to test the fix commit.
2. Provide exact install or checkout instructions.
3. Ask for terminal output, logs, or a short screen recording when relevant.
4. Close the issue only after the reporter confirms the failure no longer
   reproduces.

### Maintainer fallback path

Use this path when the reporter is unavailable or cannot test the fix.

1. Recreate the reported environment as closely as practical.
2. Use the same provider and model class if provider behavior is part of the
   failure.
3. Run the documented reproducer against the fix commit.
4. Attach the maintainer repro notes to the issue.
5. State which parts of the environment could not be matched.

### Environmental escalation path

If the reproducer depends on unavailable local state, credentials, provider
behavior, timing, or platform details:

1. Keep the issue open.
2. Label or note it as environment-dependent repro pending.
3. Ask for the missing environment details or sanitized logs.
4. Add a maintainer-owned minimized reproducer if one can be derived.
5. Land extra diagnostics when the failure cannot be observed directly.
6. Re-run the repro after diagnostics or environment access is available.

Do not close a race-condition issue based only on unit tests, typecheck, or a
green CI run.

### Closure note template

```text
Post-fix repro verification:
- Issue: #<number>
- Fix commit: <hash>
- Verified by: <reporter or maintainer>
- Environment: <os, runtime, provider, model>
- Reproducer: <link or summary>
- Result: original failure no longer reproduces
```
