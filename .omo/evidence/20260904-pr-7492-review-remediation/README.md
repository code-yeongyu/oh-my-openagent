# PR 7492 Review Remediation

## What Was Tested

- Failing-first and passing runs of
  `bun test packages/omo-opencode/src/testing/create-plugin-module.test.ts`.
- The focused startup test plus all `packages/omo-opencode/src/config` tests.
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`.
- `bun run build`.
- The `opencode-qa` common self-check and isolated TUI smoke.
- A real OpenCode 1.18.28 server loading the built local plugin from a canonical
  project `.opencode/opencode.jsonc`.
- Canonical HOME, XDG data, and database paths plus explicit containment
  assertions for the isolated run.
- Host OpenCode database session counts before and after the isolated run.

## What Was Observed

- Before implementation, the canonical project config case emitted no toast,
  and migration plus diagnostics produced a green `Configuration migrated`
  toast. The focused run reported 14 pass and 2 fail.
- After replaying the change on the current remote head, the focused run
  reported 17 pass and 0 fail.
- The related config and startup run reported 176 pass and 0 fail.
- The adapter typecheck and full root build exited successfully.
- The OpenCode QA harness found all required dependencies and removed its
  sandbox. The TUI rendered, accepted input, tore down, and reported the real
  database unchanged.
- The real server loaded the built local plugin and emitted:

```text
[oh-my-openagent] OMO ignores "categories" in <project>/.opencode/opencode.jsonc; move it to <project>/.omo/omo.jsonc.
```

- `/global/health` returned HTTP 200 from OpenCode 1.18.28.
- The replacement receipt records capture ID, timestamp, tested commit, runner,
  driver, successful HTTP statuses, resolved sandbox paths, zero isolated
  sessions, and successful teardown.
- The host session count was 8072 before and after. The server was terminated
  and the port refused subsequent connections.
- A follow-up failing-first test proved that project diagnostics previously
  pointed at the user-wide config. The corrected focused suite passed 17/17,
  the related suite passed 176/176, and real OpenCode displayed the
  project-scoped destination.

## Why It Is Enough

The tests exercise both reviewed branches in the production plugin factory:
canonical project discovery and warning precedence during migration. The real
server proves that OpenCode loads the built plugin and exposes the warning on
the intended project surface. Canonical path containment proves isolation;
the isolated TUI and unchanged real database count separately cover the
harness boundary and host-state risk.

## What Was Omitted

Temporary sandbox paths and unrelated duplicate-skill startup noise were
excluded. No credentials, auth headers, environment dump, or private
personal-skill details were recorded.

## Artifacts

- `failing-first.txt`
- `focused-tests.txt`
- `related-tests.txt`
- `typecheck.txt`
- `build.txt`
- `opencode-qa.txt`
- `live-server.txt`
- `project-scope-follow-up.txt`
