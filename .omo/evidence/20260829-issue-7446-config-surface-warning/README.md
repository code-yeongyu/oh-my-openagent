# Issue 7446 Config Surface Warning

## What was tested

- Failing-first startup regression:
  `bun test packages/omo-opencode/src/testing/create-plugin-module.test.ts`
- Surface: OpenCode plugin startup with `categories` placed in an isolated
  `opencode.jsonc`.
- Intended behavior: emit one configuration diagnostic that names the ignored
  surface and points users to `~/.omo/omo.jsonc`.

## What was observed before the fix

```text
Expected number of calls: 1
Received number of calls: 0
1 tests failed
15 pass
```

## What was observed after the fix

- Focused startup suite: `15 pass, 0 fail`.
- Related config and startup suites: `185 pass, 0 fail`.
- OpenCode adapter typecheck: clean.
- Root build: all steps completed.
- OpenCode QA harness self-check: pass.
- Isolated OpenCode TUI smoke: rendered, accepted input, and tore down.
- Real OpenCode 1.18.25 loaded the built local plugin and emitted:

```text
[oh-my-openagent] OMO ignores "categories" in .../opencode.jsonc; move it to ~/.omo/omo.jsonc.
```

- The isolated plugin log recorded the same diagnostic before agent
  registration, proving the production startup path fired.
- Host database isolation: session count remained `7946`.
- Reviewer-repeatable sanitized captures for the expanded source discovery,
  exact warning text, and before/after database checks are committed under
  [`../20260904-pr-7492-review-fixes/`](../20260904-pr-7492-review-fixes/).
  The directory's `README.md` maps each real OpenCode scenario to its captured
  artifact.

## Why this evidence is enough

The deterministic startup regression exercises the production plugin factory and
asserts both console and TUI warning surfaces. The real harness smoke proves the
built plugin remains loadable through OpenCode, and the isolated server proof
shows the warning before agent registration without touching the host database.

## What was omitted

- Temporary sandbox paths are summarized.
- No tokens, credentials, authorization headers, or private configuration
  values are included.
