# Issue #7454 QA Evidence

## What was tested

### Focused regression suite

Command:

```text
bun test packages/omo-opencode/src/hooks/non-interactive-env/index.test.ts packages/omo-opencode/src/hooks/non-interactive-env/windows-background.test.ts
```

Observed:

```text
29 pass
0 fail
97 expect() calls
Ran 29 tests across 2 files.
```

The regression cases cover native-Windows `nohup ... &`, a trailing single `&`, `&&`,
PowerShell `Start-Process`, non-Windows behavior, unchanged command arguments on
rejection, and the stable guidance error contract.

### Real OpenCode CLI tool surface

The exact hook module was bundled to disposable JavaScript inside a disposable
Docker QA container, then loaded by a temporary plugin wrapper. The wrapper
temporarily set the runtime platform to `win32` only for the delegated hook call.
The model was a local fake Responses API that emitted the exact tool call:
`nohup bun run dev &`.

Command shape:

```text
script/agent/qa-docker.sh --no-config exec bash -lc 'source script/agent/qa-sandbox.sh; ...; timeout -k 5s 30s opencode run --format json --title qa-7454 --model openai/gpt-fake --dir /workspaces/oh-my-openagent RUN_BACKGROUND_HOOK_PROBE'
```

Observed:

```text
SESSION_COUNT_BEFORE=0
RUN_STATUS=0
SESSION_COUNT_AFTER=1
TOOL_EVENTS= 1
TOOL_STATUS= error
TOOL_ERROR= Native Windows cannot safely return from POSIX background commands (`nohup ... &` or a trailing `&`) because child processes inherit the bash tool's output handles. Use PowerShell `Start-Process` with redirected standard output and error instead.
HOOK_FIRED=
1
FAKE_REQUESTS=
2
HOOK_FIRED bash nohup bun run dev &
```

The structured tool event had `status: "error"`; there was no completed shell
output and the command was rejected before execution. The session count changed
only inside the throwaway XDG sandbox. The fake provider received two local
requests: one tool-call response and one terminal text response. No host
OpenCode or Codex configuration was mounted.

### OpenCode server smoke

Command:

```text
script/agent/qa-docker.sh --no-config exec bash .agents/skills/opencode-qa/scripts/server-smoke.sh --self-test
```

Observed: passed isolated `/global/health`, OpenAPI discovery with 162 paths, and
unauthenticated `/session` rejection with HTTP 401.

### Static and build gates

Commands and outcomes:

```text
bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts \
  packages/omo-opencode/src/hooks/non-interactive-env/constants.ts \
  packages/omo-opencode/src/hooks/non-interactive-env/non-interactive-env-hook.ts \
  packages/omo-opencode/src/hooks/non-interactive-env/windows-background.test.ts
# No violations in 3 file(s).

bun run typecheck
# passed: root scripts, workspace packages, and omo-opencode

bun run build
# passed: build: all steps completed
```

LSP diagnostics reported no diagnostics for the two production files. The test
file also reported no diagnostics when checked with a temporary test-only
`tsconfig.json`; that file was deleted afterward.

## What was observed

- The guard runs before the existing banned-command and Git-prefix logic.
- Native-Windows background syntax is rejected with the original command still
  present in `output.args.command`.
- `&&`, `Start-Process`, and non-Windows `nohup ... &` paths remain unchanged.
- The built hook bundle reaches the real OpenCode `tool.execute.before` surface.
- The repository-wide suite ran 16844 tests across 2164 files in 453.01s but had
  7 unrelated baseline/environment failures: one generated Codex installer
  version assertion and five auto-update-checker registry assertions receiving
  live npm version `3.0.1` instead of test fixtures; the remaining failure was
  part of the generated-artifact failure context. The focused changed-file
  suite was green.

## Why this is enough

The unit tests lock the platform and syntax boundaries, while the isolated real
OpenCode CLI run proves that the bundled hook receives the exact model-emitted
`bash` call and returns an error before the shell command runs. The server smoke
and XDG/session-count checks prove the harness was isolated and usable. The
build and typecheck gates prove the published bundle includes the guard.

## What was omitted

- A native Windows runner was unavailable in this Linux QA environment. The
  `win32` branch was simulated in the real OpenCode process; Windows-specific
  process-handle inheritance still needs the repository's Windows CI or a native
  Windows run.
- `sse-hook-probe.sh --self-test` was attempted but timed out during its
  readiness wait without output. It targets lifecycle SSE events, whereas this
  change is a `tool.execute.before` guard, so it was not treated as a pass or as
  proof of this fix.
- A full `dist/index.js` plugin wrapper probe was inconclusive under the QA
  image's OpenCode 1.18.23 plugin loading path. The exact changed hook bundle was
  instead exercised through a minimal real plugin wrapper; no claim is made that
  the inconclusive full-wrapper attempt was a passing result.

No credentials, auth headers, host database contents, or private environment
values are included here.
