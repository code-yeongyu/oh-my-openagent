# Issue 7471 Session Resume Diagnostics

## What was tested

- Failing-first launcher regression:
  `bun test packages/omo-native/test/launcher.test.ts`
- Surface: the published `omo-ai` launcher forwarding `--session <id>` to the
  pinned Senpi engine.
- Intended behavior: when a JSONL filename contains the requested ID but its
  session header has a different canonical ID, the launcher must identify the
  searched root, rejected candidate, mismatch, and valid resume alternatives.

## What was observed before the fix

The new regression failed because the launcher printed no diagnostic:

```text
Expected to contain: "searched .../.omo/agent/sessions"
Received: ""
1 tests failed
37 pass
```

The fake Senpi process still received the original session ID, proving the
failure is diagnostic rather than argument forwarding.

## What was observed after the fix

- Focused regression: `38 pass, 0 fail`
  ([focused-launcher-test.txt](./focused-launcher-test.txt)).
- Full omo-native suite: `246 pass, 0 fail`
  ([package-tests.txt](./package-tests.txt)).
- Package typecheck: clean
  ([typecheck.txt](./typecheck.txt)).
- Package build: completed with 36 required staged artifacts
  ([build-omo-native.txt](./build-omo-native.txt)).
- The shipped launcher reported `omo 5.0.0-0.beta.39` with pinned
  `senpi 2026.9.3-3`
  ([launcher-version.txt](./launcher-version.txt)).
- The complete command list is recorded in
  [commands.txt](./commands.txt).
- Real isolated launcher output identified:
  - the explicit isolated agent directory as the searched root,
  - the exact mismatched JSONL candidate,
  - the canonical header ID,
  - both `omo --session <header-id>` and path-based resume alternatives.
- The exact output is in
  [session-mismatch-isolated.txt](./session-mismatch-isolated.txt), with the
  synthetic input preserved under
  [sandbox-agent/](./sandbox-agent/).
- `--help` rendered the real command surface
  ([launcher-help.txt](./launcher-help.txt)).
- Invalid `--session-id 'bad/id' --print` exited 1 with the expected validation
  message ([invalid-input.txt](./invalid-input.txt)).
- Protected files under the real `~/.omo/agent` and `~/.senpi/agent`
  directories were hashed before and after the isolated launcher run and were
  byte-identical. See [real-home-before.txt](./real-home-before.txt),
  [real-home-after.txt](./real-home-after.txt), and
  [isolation-verdict.txt](./isolation-verdict.txt).

## Why this evidence is enough

The regression drives the published launcher boundary with its real argument
forwarding and a fake pinned engine, while the manual QA drives the built
launcher with the actual pinned Senpi CLI. Together they prove both deterministic
diagnostic behavior and unchanged engine handoff. The before/after protected-file
digests additionally prove that the real agent homes were not changed while the
launcher used its explicit isolated agent directory.

## What was omitted

- Raw provider credentials, tokens, environment dumps, and private session
  content were not captured.
- Protected-file evidence contains only file paths and SHA-256 digests, never
  file contents.
- The committed session fixture is synthetic and contains no user data.
