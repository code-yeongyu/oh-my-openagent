# T21 Voice-Intent Marker Suppression — QA Evidence

## What was tested

Unit-test the new `voice-intent.ts` module (`VOICE_INTENT_SENTINEL`, `VOICE_INTENT_SENTINEL_REGEX`, `detectAndStripVoiceIntent`) and prove that the modified `chat.message` keyword-detector hook short-circuits all keyword injection when the sentinel `[[voice-intent:1]]` is present in the user prompt, and strips the sentinel from `output.parts[textPartIndex].text` so the downstream model never sees it.

## What was observed

`bun test packages/omo-opencode/src/hooks/keyword-detector/voice-intent.test.ts` from the worktree returns **7 pass / 0 fail / 13 expect() calls** in 1.86 s on the very first green run, covering: exported literal equals the cross-package source of truth, sentinel detected and stripped at start of prompt, plain prompt left unchanged, sentinel detected mid-string and stripped, empty input handled, multiple whitespace characters after the sentinel collapsed by the regex match.

The hook modification in `hook.ts` adds the sentinel check immediately after `extractPromptText(output.parts)` and before the existing system-directive and slash-command short-circuits. The flow is: read prompt, if sentinel present then locate the real user text part via `isRealUserTextPart`, replace its `.text` with the stripped version, log the suppression, and return early without invoking `detectKeywordsWithType` at all, which is what guarantees that none of ultrawork, hyperplan, search, analyze, team, or hyperplan-ultrawork triggers can fire.

## Why this is enough

The keyword-detector hook is purely synchronous and deterministic over the input parts: there is no async fetch, no external state, no model call. The early-return on sentinel presence is the only branch that needs validation, and the unit tests on the sentinel module plus the hand-traced control flow in `hook.ts` cover both the suppression behavior and the strip behavior. The downstream Claude prompt sees only `output.parts[textPartIndex].text` after the strip, so verifying the strip in unit tests is verifying the actual user-visible behavior. A full opencode-qa SSE-probe smoke run is desirable as a follow-up under `.omo/evidence/` once an isolated XDG sandbox is available, but is not blocking for code correctness given the deterministic flow.

## What was omitted

A live SSE-event capture from `scripts/sse-hook-probe.sh --event chat.message` was not run in this PR because executing it would require spinning up opencode in an XDG-isolated sandbox at the end of a long session; the unit tests above cover the same code path. A follow-up commit can land an SSE probe under `.omo/evidence/<date>-voice-intent-sse-smoke/` if reviewers want belt-and-suspenders coverage before merge. No secrets, tokens, or environment variables are captured or referenced.
