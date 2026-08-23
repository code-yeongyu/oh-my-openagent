# PR #6611 seven-blocker QA summary

Captured 2026-08-20 from task-owned worktree head based on
`1cca53e227ee28e1920c349a9630c01fc7ad8486`.

## Review findings proven

1. Stale retry generations are rejected after message lookup, reserved-retry waits,
   prompt-gate awaits, and at the actual queued `promptAsync` invocation.
2. A timeout owns the `FallbackState` present when it is scheduled and cannot
   abort or dispatch for a replacement generation.
3. Registered session-category reasoning/variant settings qualify retry payloads
   before resolved-agent settings.
4. `session.created` indexing uses the same registered-category effective model
   identity as fallback selection.
5. Primary restoration derives the effective primary identity and removes a
   fallback-only variant while preserving a configured inherited primary variant.
6. Explicit `reasoningEffort` survives beside an inline fallback variant.
7. Only text carrying `OMO_RUNTIME_FALLBACK_RETRY` acknowledges a synthetic
   runtime-fallback retry; unrelated synthetic continuations remain ignored.

## RED -> GREEN evidence

- `red.txt`: unchanged production code failed all seven new regressions
  (`7 fail, 113 pass`).
- `green-focused.txt`: the seven finding regressions and adjacent coverage passed
  (`120 pass, 0 fail`).
- `queue-generation-red.txt` / `queue-generation-green.txt`: a final queue-drain
  audit first proved an obsolete queued fallback reached `promptAsync` (`1 fail`),
  then proved the prompt gate's dispatch-time generation predicate cancels it
  (`12 pass, 0 fail`).

## Automated verification

- `related-tests-final.txt`: runtime fallback, plugin adapter, prompt-route audit,
  and all shared prompt-gate suites passed (`424 pass, 0 fail`) on Bun 1.3.12.
- `typecheck-final.txt`: root, scripts, and all workspace package TypeScript checks
  exited zero on Bun 1.3.12.
- `build-final.txt`: the complete workspace build exited zero on Bun 1.3.12.
- `bundle-sha256-final.txt`: source-current `dist/index.js` SHA-256 is
  `a60f0a25ddb228cfa08497e399edffd9f1db1d75fcaf403e51932ab904839f66`.
- The final root suite passed `15050` tests, skipped `11` platform-gated tests,
  and failed `0` across `1961` files on Bun 1.3.12. The full 2.1 MB output remains
  in the task evidence directory as `root-bun-test-final-current.txt`; this
  concise receipt avoids adding repetitive output to the repository.
- The root run initially exposed a date-expired Senpi completion fixture. The
  focused test reproduced under both Bun 1.3.14 and CI-pinned Bun 1.3.12; moving
  the fixture to a stable one-minute-old module timestamp passed all 10 focused
  cases and the final root suite.

## Real OpenCode QA

- `opencode-qa-common-self-check.txt`: all harness dependencies, DB lookup,
  escaping, free-port, isolated HOME/XDG, shim preservation, and trap cleanup passed.
- `opencode-qa-sse-self-test.txt`: an isolated authenticated server emitted
  `server.connected` over `/event`.
- `opencode-source-qa.sh` / `opencode-source-qa.txt`: OpenCode 1.18.18 loaded the
  exact source-built bundle above from a file URL, accepted an API prompt with
  HTTP 204 against a deterministic local OpenAI-compatible provider, and emitted
  `session.status`, `message.updated`, and a `message.part.updated` text event
  (`fake response 2`).
- The QA session existed only in the isolated DB. The host DB session count was
  `7585` before and after. The XDG sandbox was removed, and both OpenCode and fake
  provider processes were confirmed stopped.

No credentials, auth headers, server passwords, environment dumps, or private
provider payloads are included in these artifacts.
