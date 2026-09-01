# QA evidence: Windows EPERM on uv_spawn of cmd.exe (#7162)

Date: 2026-08-24
Branch: issue/7162-windows-eperm-cmd-spawn (base: dev @ 8833800ae)
Scope: packages/utils/src/command-executor + packages/omo-opencode/src/hooks/codegraph-bootstrap
(claudeCodeHooks dispatch and codegraph-bootstrap spawn sites only)

## WHAT WAS TESTED

1. Failing-first regression tests, written before the implementation:
   - `packages/utils/src/command-executor/windows-shell.test.ts` (new): 7 cases for
     `resolveWindowsCmdPath()` covering non-win32 null, COMSPEC hit, COMSPEC miss with
     SystemRoot fallback, bare SystemRoot, windir fallback, hardcoded
     C:\Windows\System32\cmd.exe fallback, and null when nothing resolves.
   - `packages/utils/src/command-executor/execute-hook-command.test.ts` (extended): stubs
     `process.platform` to win32, sets COMSPEC to a temp file, mocks `node:child_process`
     spawn, calls `executeHookCommand()`, and asserts the spawn options carry the absolute
     COMSPEC path as `shell` (mock restored in finally).
   - `packages/omo-opencode/src/hooks/codegraph-bootstrap/command-runner.test.ts` (extended):
     pins that a win32 `.cmd` invocation wraps through the resolved absolute cmd.exe
     (COMSPEC case, SystemRoot case) and falls back to literal "cmd.exe" when nothing
     resolves; the pre-existing bare-name case now injects empty env plus a never-matching
     fileExists so it is deterministic on every host.
2. Scoped suites after implementation:
   - `bun test packages/utils/src/command-executor/` (green-utils-command-executor.txt)
   - `bun test packages/omo-opencode/src/hooks/codegraph-bootstrap/` (green-codegraph-bootstrap.txt)
   - `bun test packages/omo-opencode/src/hooks/claude-code-hooks/` (green-claude-code-hooks.txt)
   - `bun test packages/omo-opencode/src/shared/command-executor/` (green-shared-command-executor-shims.txt)
3. `bun run typecheck` (tsgo --noEmit root + script + all workspace packages), exit 0
   (typecheck.txt).

## WHAT WAS OBSERVED

- RED before the fix: windows-shell.test.ts failed with
  `Cannot find module './windows-shell'`; the execute-hook-command win32 test received
  `shell: true` instead of the absolute COMSPEC path; both new command-runner cases
  received `"command": "cmd.exe"` instead of the absolute path.
- GREEN after the fix: utils command-executor 14 pass / 0 fail; codegraph-bootstrap
  23 pass / 0 fail; claude-code-hooks 116 pass / 0 fail; shared shims 6 pass / 0 fail;
  typecheck exit=0. Full logs in this directory.

## WHY IT IS ENOUGH

- The resolver contract is pinned with injected env/fileExists/platform, so the tests are
  deterministic on any host and cannot drift with the machine they run on.
- The execute-hook-command test proves the actual wiring end to end at the unit level:
  what Node's spawn receives as `shell` on win32 is the absolute cmd.exe path, which is
  exactly the value libuv passes to uv_spawn (the failing syscall in the issue log).
- The command-runner tests pin both resolution tiers and the fail-open fallback, so a
  future regression to the bare-name spawn fails CI instead of shipping.
- Fail-open design: when no absolute path can be resolved, both call sites keep today's
  behavior (`shell: true` / literal "cmd.exe"), so healthy systems are unaffected.

## WHAT WAS OMITTED

- Live Windows verification: this host is Linux, so the real win32 uv_spawn path could not
  be driven against a real OpenCode instance; the opencode-qa live-harness pass exercises
  the POSIX code path only, where behavior is unchanged by design. The reporter's exact
  EPERM trigger (security software or sanitized PATH hitting the CreateProcess search) can
  only be reproduced on Windows; residual risk is documented here instead.
- The Codex edition has its own separate copy of the wrapper in
  packages/omo-codex/plugin/components/codegraph/src/session-start-command.ts; it is a
  different surface from #7162 and was intentionally left untouched.
- No secrets, tokens, or host-identifying paths appear in the captured outputs; env values
  used in tests are synthetic fixture paths under the OS temp dir.
