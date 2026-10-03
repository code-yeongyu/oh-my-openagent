# Background notification error bound QA

Issue: https://github.com/code-yeongyu/oh-my-openagent/issues/8325

Base: `dev@c43a34195babfb8555cd9512ff4a71bbf7724cc1`

The real OpenCode QA artifact was recorded on `dev@9af447adae9d0a551c777a9d0948848485e516ad`. The entire `packages/omo-opencode/src/features/background-agent` directory is unchanged between that revision and the final base; the affected suite, repository typecheck, and repository build were rerun on the final base.

## Change under test

The patch limits each provider error copied into a parent background-task notification to 2,000 JavaScript string units. Long values keep their diagnostic prefix and end with an explicit marker containing the original length. The stored task and retry-attempt errors are not changed.

The formatter is applied at all five reported parent-notification boundaries:

1. partial failed-task notification
2. final failed-task summary
3. retry attempt timeline
4. retrying notification
5. retry-session-ready notification

## Automated verification

All commands used Bun 1.4.2, matching the current CI workflows.

### Failing first

Command:

```text
bun test packages/omo-opencode/src/features/background-agent/background-task-notification-template.test.ts packages/omo-opencode/src/features/background-agent/manager.test.ts
```

Artifact: `red-focused-tests.txt`

Observed before the production change:

- 202 passed
- 5 failed
- every failure was an expected 513,039-character notification error exceeding the 2,000-character bound
- the five failures covered the three template paths and two manager retry paths

### Affected subsystem

Command:

```text
bun test packages/omo-opencode/src/features/background-agent
```

Artifact: `background-agent-tests-latest-base.txt`

Observed:

- 771 passed
- 0 failed
- 1,976 expectations
- 65 files

### Repository typecheck

Command:

```text
bun run typecheck
```

Artifact: `typecheck-latest-base.txt`

Observed: root, script, and all workspace package typechecks passed.

### Repository build

Command:

```text
bun run build
```

Artifact: `build-latest-base.txt`

Observed: the complete build passed. The build-generated `packages/omo-codex/scripts/install-dist/install-local.mjs` was restored to the exact base revision because this patch does not change the Codex installer.

## Real OpenCode QA

The real OpenCode 1.18.29 server was started with isolated HOME and XDG directories. The worktree plugin was loaded with a `file:` URL. A local fake OpenAI-compatible provider made the real parent session call the real task tool, then returned a deterministic 513,039-character provider error for three child attempts.

Reusable drivers:

- `fake-openai-error-server.mjs`
- `run-real-opencode-qa.mjs`

Run shape:

```text
OPENCODE_BIN=<opencode> OMO_QA_TEMP_ROOT=<task-temp-root> node .omo/evidence/20260916-background-error-truncation/run-real-opencode-qa.mjs
```

Primary artifact: `real-opencode-qa-result.json`. The reusable driver writes detailed per-run receipts locally; the committed result keeps the exact sanitized aggregate needed for review without retaining machine-specific session identifiers or redundant files.

Observed:

- real task-tool call: 1
- child provider failures: 3
- parent wake request: 1
- notification kinds observed: `retry` and `all-finished`
- rendered error length in each captured notification: 2,000
- original length marker: 513,039
- diagnostic prefix present: yes
- unique tail sentinel present: no
- full 513,039-character value present in the parent request: no
- retry notification length: 5,056
- combined retry plus final notification length: 18,738
- parent request body length: 126,543
- `plugin.added` events: 45
- `session.error` events: 3
- SSE parse errors: 0
- sandbox database: 4 sessions, 12 messages, 15 parts
- real OpenCode database session count: 12 before and 12 after
- fake provider stopped: yes
- OpenCode server stopped: yes

## Why this evidence is sufficient

The failing-first tests prove the existing behavior was unbounded at each reported interpolation boundary. The subsystem suite covers surrounding lifecycle and wake behavior. Root typecheck and build cover repository integration. The real harness run proves that the local plugin receives three large provider failures through OpenCode, generates retry and completion notifications, sends only bounded error copies to the parent, emits the expected SSE lifecycle events, and leaves the real user database unchanged.

## Omitted and residual risk

- Raw request bodies and full provider errors were intentionally not retained because the measurements and sentinel assertions are sufficient and avoid committing multi-megabyte payloads.
- No credentials, authorization headers, environment dumps, or machine-local absolute paths are committed.
- The final local test gate is the complete background-agent subsystem. The repository-wide CI suite remains the authoritative cross-platform gate. An earlier local broad run exposed only unrelated Windows symlink, temp-root, and tmux environment failures, so those noisy logs are not part of this evidence package.
- The limit applies per embedded error occurrence. A notification containing many failed tasks can still grow with task count, but each provider error can contribute at most 2,000 units instead of an unbounded payload.
