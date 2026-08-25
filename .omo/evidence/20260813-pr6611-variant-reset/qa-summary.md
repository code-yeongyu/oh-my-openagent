# QA summary - PR #6611 variant-only retry generation

Captured 2026-08-13 on Windows 11 with Bun 1.3.14. Real OpenCode QA
ran under WSL2 as the non-root `codexqa` user with OpenCode 1.18.13.

## What was tested

1. A red-green regression at the real `chat.message` handler seam. The test
   seeds retained retry keys for a previous low variant, starts from high, and
   changes only the top-level OpenCode variant to low.
2. The focused chat-message, session-status, and runtime model normalization
   tests.
3. The complete runtime-fallback directory.
4. The TypeScript no-excuse audit and workspace package typecheck.
5. An isolated production build of the OpenCode plugin entry.
6. A real isolated OpenCode server loaded with this worktree's
   `dist/index.js`; the driver subscribed before prompting and awaited a
   `session.status` event.
7. Host and sandbox cleanup after real-harness QA.

## What was observed

- Before the source fix, the variant-only regression failed because the
  handler retained the base identity `openai/gpt-5.4`.
- After using the existing variant-aware runtime model normalizer, the final
  high-to-low regression passed and cleared the retained retry-key generation.
- Focused tests passed: 14 pass, 0 fail.
- Complete runtime-fallback tests passed: 257 pass, 0 fail.
- The no-excuse audit reported no violations.
- Workspace package typecheck exited zero after merging current upstream dev.
- The isolated OpenCode entry built successfully.
- The exact source-loaded `dist/index.js` was rebuilt after the variant fix,
  hashed as `46da5c49dc88c27840fd70d6a61f33ae316531cc5d34162b4e6d3cede13473e5`,
  and asserted to contain output-first variant resolution plus canonical
  runtime-model parsing, effective pending fallback identity, and manual
  watchdog cleanup, true model-less generation acknowledgment, and equivalent
  fallback indexing, category-inherited variant resolution, stale-timeout
  generation rejection, synthetic retry adapter acknowledgment,
  capability-aware created-fallback indexing, accepted-queued state
  preservation, explicit-variant precedence, capability-aware reasoning
  lowering, and defined replacement-state identity guards before OpenCode
  started.
- The real prompt returned HTTP 204 and the SSE subscription observed
  `{"type":"session.status"}`.
- OpenCode loaded this worktree's `dist/index.js`.
- The real OpenCode database contained 0 sessions before and after QA.
- The driver captured `/tmp/oqa-xdg.3UxQvB`, the helper's actual `oqa-xdg.*`
  sandbox, and asserted `sandbox_removed=true` after cleanup.

Exact concise captures:

- `red-green.txt`
- `verification.txt`
- `manual-qa.txt`
- `opencode-hook-qa.sh`
- `opencode.json`

## Why it is enough

The regression toggles the exact P2 finding: a variant-only manual selection
now creates a new retry generation instead of matching retained keys from an
older occurrence of that variant. The focused and full suites cover adjacent
model-aware deduplication, missing model metadata, pending fallbacks, cooldowns,
and retry cleanup. Typecheck and the isolated entry build validate the shipped
OpenCode code. The bundle hash and wiring assertion tie that build to the exact
file loaded by OpenCode. The real isolated OpenCode run proves the
source-current plugin surface receives the matching lifecycle event without
touching the host DB.

## What was omitted

No credentials, tokens, authentication headers, environment dumps, session
payloads, or raw secret-bearing logs were copied. Repetitive compiler output
was summarized with commands, exit status, and test counts. The full repository
build's unrelated OneDrive file-open error is described in `verification.txt`
instead of being hidden.
