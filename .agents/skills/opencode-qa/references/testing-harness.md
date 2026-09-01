# opencode Test Harness (how opencode QAs itself)

This is reference material for writing and running tests against the opencode source. The skill's own QA scripts (CLI, curl, sqlite) do not require this, but it is the authoritative pattern when you need a unit or integration test.

## Table of Contents

1. [Runner and the root guard](#runner-and-the-root-guard)
2. [Test bootstrap (in-memory, isolated)](#test-bootstrap-in-memory-isolated)
3. [Effect-based harness (test/lib/effect.ts)](#effect-based-harness-testlibeffectts)
4. [Instance and tmpdir fixtures (test/fixture/fixture.ts)](#instance-and-tmpdir-fixtures-testfixturefixturets)
5. [CLI subprocess harness (test/lib/cli-process.ts)](#cli-subprocess-harness-testlibcli-processts)
6. [Fake LLM server (test/lib/llm-server.ts)](#fake-llm-server-testlibllm-serverts)
7. [Representative test shapes](#representative-test-shapes)
8. [App e2e (Playwright)](#app-e2e-playwright)
9. [Test style conventions](#test-style-conventions)

## Runner and the root guard

The runner is `bun test` (Bun built-in, not vitest or jest).

Tests cannot run from the repo root. Two guards enforce this:

- `bunfig.toml` at repo root sets `root = "./do-not-run-tests-from-root"`
- Root `package.json` has `"test": "echo 'do not run tests from root' && exit 1"`

Run from a package directory instead:

```bash
cd packages/opencode && bun test --timeout 30000
```

Run a single file:

```bash
bun test test/tool/read.test.ts
```

Filter by test name:

```bash
bun test --grep "truncates large file"
```

CI variant:

```bash
bun run test:ci
```

Turbo dependency: `opencode#test` depends on `^build`.

## Test bootstrap (in-memory, isolated)

The preload file is `packages/opencode/test/preload.ts`. It is wired via `packages/opencode/bunfig.toml`:

```toml
[test]
preload = ["@opentui/solid/preload", "./test/preload.ts"]
```

What it does:

- Sets `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, and `XDG_STATE_HOME` to temp directories
- Sets `OPENCODE_TEST_HOME`
- Sets `OPENCODE_DB=":memory:"` (SQLite in-memory)
- Wipes all provider API keys from `process.env`
- Sets `OPENCODE_EXPERIMENTAL_EVENT_SYSTEM=true`
- Sets `OPENCODE_EXPERIMENTAL_WORKSPACES=true`
- Initializes `Log.init({ print: false })`
- Calls `initProjectors()`

## Effect-based harness (test/lib/effect.ts)

The `it` factory wraps `bun:test` with three variants:

- `it.effect(name, body)` ... TestClock + TestConsole (isolated time)
- `it.live(name, body)` ... real clock + TestConsole
- `it.instance(name, body, opts)` ... real clock + scoped tmpdir + a real Instance context

`testEffect(layer)` builds an `it` bound to an Effect layer:

```typescript
const it = testEffect(Layer.mergeAll(readLayer(), testInstanceStoreLayer))
```

## Instance and tmpdir fixtures (test/fixture/fixture.ts)

- `tmpdirScoped(options?)` ... scoped temp directory. Optional `git: true`, optional `config` (writes `opencode.json`), optional `init`.
- `provideInstance(directory)(effect)` ... runs an Effect inside a real instance for that directory.
- `withTmpdirInstance({ git?, config?, init? })(effect)` ... one-liner: make tmpdir, optional git init + config, provide instance.
- `testInstanceStoreLayer` ... instance store with a no-op bootstrap.

## CLI subprocess harness (test/lib/cli-process.ts)

`cliIt.live(name, body, timeoutMs?)` and `cliIt.concurrent(...)` spawn the real CLI (`bun run --conditions=browser src/index.ts`) in an isolated environment.

Exposed helpers:

- `opencode.run()`
- `opencode.serve()`
- `opencode.acp()`
- `expectExit`
- `parseJsonEvents`

Isolation environment keys:

- `OPENCODE_TEST_HOME`
- `OPENCODE_CONFIG_CONTENT` (inline provider config)
- `OPENCODE_DISABLE_PROJECT_CONFIG=1`
- `OPENCODE_PURE=1`
- `OPENCODE_DISABLE_AUTOUPDATE=1`
- `OPENCODE_DISABLE_AUTOCOMPACT=1`
- `OPENCODE_DISABLE_MODELS_FETCH=1`

Real example from `packages/opencode/test/cli/serve/serve-process.test.ts`:

```typescript
cliIt.live("spawns serve and health responds", async ({ opencode, expectExit }) => {
  const server = await opencode.serve()
  expect(server.port).toBeGreaterThan(0)
  const res = await fetch(`${server.url}/global/health`)
  expect(res.status).toBe(200)
})
```

## Fake LLM server (test/lib/llm-server.ts)

`TestLLMServer` is an in-process OpenAI-compatible SSE server to mock model responses deterministically.

Methods:

- `llm.text("hello")`
- `llm.tool("read", { filePath: "x" })`
- `llm.pushMatch(matchFn, reply)`

This is how tests avoid real provider calls.

## Representative test shapes

### 1. Tool test

From `packages/opencode/test/tool/read.test.ts`:

```typescript
const it = testEffect(Layer.mergeAll(readLayer(), testInstanceStoreLayer))

it.instance("truncates large file over maxReadFileSize", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    // ... exercise the read tool, assert truncation
  })
)
```

### 2. Session/event test

From `packages/opencode/test/session/session.test.ts`:

```typescript
test("session.created fires after session.create", async () => {
  const deferred = Deferred.unsafeMake<void>(FiberId.none)
  // ... listen for session.created event
  await session.create({})
  // ... assert deferred resolves
})
```

### 3. Plain unit test

From `packages/opencode/test/cli/run/runtime.boot.test.ts`:

```typescript
import { describe, expect, mock, spyOn, test } from "bun:test"

test("boots runtime without errors", () => {
  // ... standard assertions, no Effect
})
```

## App e2e (Playwright)

The app lives in `packages/app` (SolidJS). Config is `packages/app/playwright.config.ts`. It starts the Vite dev server via `webServer`; the backend is expected at `localhost:4096`.

Commands (run from `packages/app`):

```bash
bunx playwright install chromium
bun run test:e2e:local
```

Filter with grep:

```bash
bun run test:e2e:local -- --grep "settings"
```

UI mode:

```bash
bun run test:e2e:ui
```

App unit tests:

```bash
bun run test:unit
```

This equals `bun test --preload ./happydom.ts ./src`.

## Test style conventions

Per opencode AGENTS.md:

- Avoid mocks where possible. Test the real implementation. Do not duplicate logic into tests.
- Run `bun typecheck` from the package directory (uses tsgo). Never run bare `tsc`.

For runtime or scriptable QA without writing tests, use the opencode-qa scripts (Cases A-D in SKILL.md).
