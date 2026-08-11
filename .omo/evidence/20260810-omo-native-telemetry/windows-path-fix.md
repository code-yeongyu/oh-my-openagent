# Windows builtin skill path fix evidence

Date: 2026-08-10
Branch: `feat/omo-native-telemetry`
CI job: `senpi-compatibility (windows-latest)` in Actions run 31386569264, job 93448213190

## Root cause

The Windows CI failure did not reach `builtinSkillName` or its final telemetry assertion. The ANSI-stripped CI log at `/tmp/win-fail.log` shows this concrete failure:

```text
ENOENT: no such file or directory, mkdir 'C:\Users\RUNNER~1\AppData\Local\Temp\omo-native-tools-RDKAIr\plugin\skills\ulw-plan"},"feature":"goal_tool'
at createSkill (...\omo-native-tools.test.ts:64:3)
at <anonymous> (...\omo-native-tools.test.ts:89:22)
```

The injected fixture name contained `"`, which is forbidden in a Windows path component. `mkdirSync` therefore failed before the hostile-path loop and before `expect(events).toEqual([])`. macOS and Linux permit that character, which explains the single-platform failure.

The production comparison also had two uncovered Windows canonical-path defects:

1. It compared the real path components with exact-case checks (`parts[1] !== "SKILL.md"` and `BUILTIN_SKILLS.has(skillName)`), although Windows path identity is case-insensitive. A canonical Windows target ending in `DEBUGGING\skill.md` therefore returned `undefined`.
2. Mixed regular and Win32 device namespace forms, such as `C:\...` and `\\?\C:\...`, made `path.win32.relative()` return the target as an absolute path. The old `isAbsolute(pathFromRoot)` guard then rejected a path inside the same builtin root.

The `..${sep}` traversal comparison itself was separator-correct on Windows because `path.win32.relative()` returns `..\...` and Win32 `sep` is `\`.

## Fix

Production matching now operates on an explicit path-semantics input after both paths have been resolved through `realpathSync`:

- Windows device prefixes are normalized before `relative()` (`\\?\C:\...` to `C:\...`, and `\\?\UNC\server\share\...` to `\\server\share\...`).
- Windows skill directory and `SKILL.md` checks use case-insensitive comparison and return the canonical allowlisted skill name.
- POSIX keeps exact-case matching.
- The existing relative-path, traversal, cross-drive, absolute-result, two-component, filename, and allowlist gates remain fail-closed.

The hostile fixture now uses the Windows-legal injected directory name `ulw-plan},feature=goal_tool`. It still tests allowlist injection without weakening the empty-event assertion. The symlink escape uses a directory junction on Windows and a directory symlink elsewhere, so the escape case executes without a platform skip or Windows symlink privilege dependency.

## Regression coverage and RED proof

New tests drive the matcher with `node:path.win32` on every host. They cover:

- drive-letter and component case differences;
- regular and `\\?\` drive namespace forms;
- regular UNC and `\\?\UNC\` forms;
- a sibling outside the builtin root;
- a lookalike `skills-escape` root;
- another drive;
- namespaced outside paths.

I temporarily restored the old comparison body while retaining the extracted matcher seam, then ran:

```text
bun test packages/omo-senpi/src/components/telemetry/omo-native-tools.test.ts
```

The captured RED output is at `/tmp/omo-native-tools-red.txt`. The deciding failure was:

```text
Expected: "debugging"
Received: undefined
at omo-native-tools.test.ts:111:8

9 pass
1 fail
```

This proves the new Windows semantics test detects the old exact-case implementation. Restoring the production fix produced:

```text
10 pass
0 fail
20 expect() calls
```

The original hostile-path security assertion also passed unchanged as `expect(events).toEqual([])`.

## Windows VM reproduction attempt

A real Windows run could not be obtained. The documented Bunshin path to `mengmotaMac` was attempted first. The Parallels status probe exceeded the hub's 30 second invoke deadline. Afterward, even a five-second `echo mesh-ok` probe to `mengmotaMac` did not return within a 15 second local bound. The documented direct SSH fallback to `mengmotaMac` timed out, and direct SSH to guest `10.211.55.4` also timed out after an eight-second connect bound.

No VM start command was issued, so there was no VM state transition to reverse. No repository clone, source copy, or test process was started on the guest. Local Bunshin probe scripts were removed, and a local process check found no task-owned Bunshin, Parallels, or test processes. Remote process inspection was unavailable because the host remained unreachable.

## Verification

All commands ran from the task worktree.

```text
bun test packages/omo-senpi/src/components/telemetry
81 pass
0 fail
322 expect() calls
```

```text
bun run --cwd packages/omo-senpi typecheck
$ tsgo --noEmit -p tsconfig.json
exit 0
```

The production source change alters the shipped bundle, so artifacts were rebuilt with:

```text
node packages/omo-senpi/plugin/scripts/build-extension.mjs
Built omo-senpi extensions: .../omo.js, .../omo-member.js
```

The build also generated `omo-memory-mcp.js`; all three JavaScript artifacts are force-added as requested.

```text
bun test packages/omo-senpi/src/bundle-size.test.ts packages/omo-senpi/src/bundle-purity.test.ts
3 pass
0 fail
5 expect() calls
```

Final targeted test after the bundle rebuild and UNC additions:

```text
bun test packages/omo-senpi/src/components/telemetry/omo-native-tools.test.ts
10 pass
0 fail
20 expect() calls
```
