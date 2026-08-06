# Continuation fail-safe: stop re-injecting after a non-retryable request error

Issue: https://github.com/code-yeongyu/oh-my-openagent/issues/6605 (also relieves #6303, #6528)
Date: 2026-08-05
Change scope: `packages/omo-opencode/src/hooks/todo-continuation-enforcer/`
(`unrecoverable-request-error.ts` new, plus `handler.ts`, `idle-event.ts`, `non-idle-events.ts`,
`continuation-injection.ts`, `types.ts`).

Two paths were added during review and are covered by the same classifier and by unit tests:
`continuation-injection.ts` rethrows a failed `dispatchInternalPrompt` into its own catch, and a
partless `message.updated` arriving after the flag is set now defers classification to the split
part instead of clearing the flag eagerly. Suite after those additions: 145 pass, 0 fail.

## WHAT WAS TESTED

1. **Unit, failing-first.** The two new `handler.test.ts` cases run against the OLD continuation
   sources (checked out from `origin/dev`) to prove they catch the defect.
   Artifact: `unit-red-before-fix.txt`. `unrecoverable-request-error.test.ts` is excluded from that
   run because its module does not exist on `origin/dev`.
2. **Unit, green.** The whole `todo-continuation-enforcer` suite against the new implementation.
3. **Real OpenCode, hermetic sandbox.** Built the plugin from this worktree, loaded it into a real
   `opencode` 1.18.13 run inside a sandbox that isolates both the XDG dirs and the user home, drove
   a session that leaves two pending todos, and confirmed no behavioural regression plus DB isolation.
   Artifact: `opencode-qa-plugin.log`.

## WHAT WAS OBSERVED

### 1. Failing-first (old code, new tests)

```
$ git checkout origin/dev -- .../todo-continuation-enforcer/{handler,idle-event,types,non-idle-events}.ts
$ bun test packages/omo-opencode/src/hooks/todo-continuation-enforcer/handler.test.ts

  expect(state.unrecoverableErrorDetected).toBe(true)
  Expected: true
  Received: undefined

(fail) createTodoContinuationHandler > #given a compaction request rejected as non-retryable
       #when the session error arrives #then it marks the session unrecoverable and cancels the countdown

 3 pass  1 fail
```

On `origin/dev` a non-retryable 400 leaves the state untouched, so the next `session.idle` re-injects
the continuation directive and rebuilds the identical failing request.

### 2. Green (new code)

```
bun test packages/omo-opencode/src/hooks/todo-continuation-enforcer
  142 pass  0 fail  244 expect() calls  (17 files)

bun run typecheck -> exit 0
bun build packages/omo-opencode/src/index.ts --outdir dist --target bun --format esm --external zod -> exit 0
```

The error payload in `handler.test.ts` and `unrecoverable-request-error.test.ts` is the exact shape
captured from the real incident: `{ name: "APIError", data: { message: "messages.2: \`tool_use\` ids
were found without \`tool_result\` blocks immediately after: toolu_01PCXjcagoMAca32awicQHce.",
statusCode: 400, isRetryable: false } }`.

### 3. Real OpenCode, hermetic sandbox

Sandbox `%TEMP%\omo-qa-sandbox3`, isolating `XDG_DATA_HOME` / `XDG_CONFIG_HOME` / `XDG_STATE_HOME` /
`XDG_CACHE_HOME`, `TMP` / `TEMP`, and the user home (`USERPROFILE` / `HOME` / `HOMEDRIVE` / `HOMEPATH`).
Only `auth.json` was copied in.

```
REAL_DB_SESSIONS_BEFORE=2864
SANDBOX_DB_PATH=C:\Users\pss\AppData\Local\Temp\omo-qa-sandbox3\data\opencode\opencode.db
{"type":"tool_use", ... "tool":"todowrite","state":{"status":"completed","input":{"todos":[{"content":"step one","status":"pending", ...
{"type":"text", ... "text":"WAITING"}
OPENCODE_EXIT=0
REAL_DB_SESSIONS_AFTER=2864
ISOLATION=OK
HOST_CONFIG_REFERENCES=0
```

The plugin carrying the changed continuation hook loads and drives a real session end to end, leaves
two pending todos, and produces no `[todo-continuation-enforcer]` skip lines, i.e. a healthy session
is untouched by the new branch. Host-config leak scan is clean and the real
`~/.local/share/opencode/opencode.db` session count is unchanged.

## WHY IT IS ENOUGH

- The failing-first run proves the new gate is genuinely absent on `origin/dev`, so the test is not
  vacuous and the regression is pinned.
- The decision logic is driven through the REAL `createTodoContinuationHandler` event router with the
  REAL captured production payload, not a hand-shaped stand-in.
- The hermetic run proves the changed module ships in the built plugin, loads in real opencode, and
  does not perturb a healthy session, which is the regression risk this change carries.
- The classifier is deliberately narrow (request-shape status code AND an explicit
  `isRetryable: false`), and the negative cases pin that a 429/`isRetryable: false` and a bare 400
  with no signal both stay retryable.

## WHAT WAS OMITTED

- **A live non-retryable 400 was not reproduced inside the sandbox.** Provoking one needs a provider
  that rejects the request shape; the free sandbox models return 503 queue-full instead, and the
  wedged production session that produced the original 400 cannot be replayed through a fresh
  opencode instance. The branch is therefore proven by replaying the exact captured payload through
  the real handler rather than by a live provider rejection.
- `[todo-continuation-enforcer]` idle lines do not appear in the CLI `opencode run` transcript
  because the process exits before the idle-driven continuation cycle; the healthy-session evidence
  above is about the absence of a regression, not about the skip branch firing.
- `auth.json` was copied into the sandbox but is not reproduced here. No tokens, API keys, or auth
  headers appear in any artifact.
