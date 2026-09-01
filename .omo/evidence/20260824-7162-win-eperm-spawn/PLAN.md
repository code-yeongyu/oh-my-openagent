# Plan: fix #7162 Windows EPERM on uv_spawn of cmd.exe (claudeCodeHooks + codegraph-bootstrap)

Branch: issue/7162-windows-eperm-cmd-spawn (base dev @ 8833800ae)

## Root cause

Both failing surfaces launch the Windows shell by BARE NAME, so libuv resolves
`cmd.exe` through the CreateProcess search order (application dir, current dir,
System32, PATH). Under sanitized plugin environments and/or security software
that search fails and uv_spawn returns EPERM, which is exactly the reporter's
log (`EPERM ... uv_spawn 'cmd.exe'` from both hooks).

1. claudeCodeHooks dispatch:
   `packages/utils/src/command-executor/execute-hook-command.ts` line 102-107
   spawns `spawn(finalCommand, { shell: true })`. On win32 both Node
   (`process.env.comspec || 'cmd.exe'`) and Bun resolve `shell: true` to a
   bare-name `cmd.exe` launch.

2. codegraph-bootstrap:
   `packages/omo-opencode/src/hooks/codegraph-bootstrap/command-runner.ts`
   line 55 wraps the pinned win32 `codegraph.cmd` shim as
   `{ command: "cmd.exe", args: ["/d", "/s", "/c", ...] }`, again bare name,
   spawned without shell by `runProcessWithTreeTimeout`.

## Fix direction (per operator hint)

Resolve an absolute cmd.exe path once and spawn that instead of the bare name;
keep fail-open fallback to today's behavior when nothing can be resolved:

- COMSPEC when set and the file exists
- else `%SystemRoot%\System32\cmd.exe`
- else `%windir%\System32\cmd.exe`
- else `C:\Windows\System32\cmd.exe`
- else null; callers fall back (execute-hook-command keeps `shell: true`,
  command-runner keeps literal "cmd.exe")

## Files

1. NEW packages/utils/src/command-executor/windows-shell.ts
   - `resolveWindowsCmdPath({ env?, platform?, fileExists? }): string | null`
   - pure, injectable, harness-neutral (utils core).
2. NEW packages/utils/src/command-executor/windows-shell.test.ts (given/when/then)
3. EDIT packages/utils/src/command-executor.ts barrel: export the resolver.
4. EDIT packages/utils/src/command-executor/execute-hook-command.ts
   - compute shell option once: win32 uses resolved absolute path, else true.
5. EDIT packages/utils/src/command-executor/execute-hook-command.test.ts
   - regression: stub platform=win32, mock node:child_process spawn, assert
     spawn received the absolute COMSPEC path as `shell`; restore all state.
6. EDIT packages/omo-opencode/src/hooks/codegraph-bootstrap/command-runner.ts
   - `resolveCodegraphCommandInvocation(command, args, platform, options?)`
     resolves the wrapper through the helper (additive options param).
7. EDIT packages/omo-opencode/src/hooks/codegraph-bootstrap/command-runner.test.ts
   - pin absolute-path resolution with injected env/fileExists plus fallback.
8. NEW packages/omo-opencode/src/shared/command-executor/windows-shell.ts shim
   (sibling shims re-export every utils command-executor file).

## Verification

- Failing-first: steps in todo order, scoped suites RED before implementation.
- bun test scoped: utils command-executor suite, codegraph-bootstrap suite,
  claude-code-hooks suite.
- bun run typecheck green.
- Evidence: QA.md in this directory; Linux host cannot drive real Windows
  OpenCode, documented under OMITTED.
