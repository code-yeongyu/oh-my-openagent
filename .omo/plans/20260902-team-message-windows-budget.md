# Team-message Windows test budget

## Failure

CI run `33602178990` timed out the generic fallback second-message test after
5.094 seconds on `windows-latest`.

## Change

- Preserve the test's 3 second event timeout, which detects a missing fallback
  wake.
- Give only this integration case a 15 second outer timeout on Windows for
  fixture, mailbox filesystem, and prompt-queue work.
- Keep Bun's 5 second default on other platforms.
- Add no sleep, polling, retry, skip, or weakened assertion.

## Verification

- Run the focused fallback test.
- Run the complete messaging test file.
- Typecheck the OpenCode adapter.
- Run isolated OpenCode real-harness QA and record evidence.
- Require green PR CI and Cubic before merge.
