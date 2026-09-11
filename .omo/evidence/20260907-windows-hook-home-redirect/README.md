# Hook home redirection does not take on Windows, 2026-09-07

`executeHookCommand` builds the child environment with `HOME: home`, intending every hook to resolve the user directory to the value the caller chose. On Windows nothing reads `HOME`: `os.homedir()` reads `USERPROFILE`, which Windows supplies to the child from the parent regardless of the env object handed to `spawn`. The hook therefore sees the real profile.

## Measured

`probe-home-redirect.log`, node v26.1.0 on Windows 11, spawning a child with exactly the environment the allowlist branch builds:

| child environment | `os.homedir()` in the child | `USERPROFILE` in the child |
| --- | --- | --- |
| `{ HOME: sandbox, CLAUDE_PROJECT_DIR, PATH }` as shipped | `C:\Users\LilMG` | `C:\Users\LilMG` |
| the same plus `USERPROFILE: sandbox` | the sandbox | the sandbox |

`probe-env-inheritance.log` explains the first row. Windows hands the child `USERPROFILE` and `SystemRoot` whatever the env object contains, including when it is empty:

| env passed to spawn | `USERPROFILE` seen by the child |
| --- | --- |
| `{}` | `C:\Users\LilMG` |
| `{ PATH }` | `C:\Users\LilMG` |
| `{ PATH, HOME: sandbox }` | `C:\Users\LilMG` |
| `{ PATH, HOME: sandbox, USERPROFILE: sandbox }` | the sandbox |

So the only way the redirect can take is to set `USERPROFILE` explicitly. That also matters for the `allowedEnvVars` branch, whose whole purpose is to hand a plugin-sourced hook a scrubbed environment: the real profile path arrives there even though the branch never puts it in the env.

## RED / GREEN

| run | before | after |
| --- | --- | --- |
| a hook printing `os.homedir()` with `HOME` redirected and `USERPROFILE` pointing elsewhere | returns the `USERPROFILE` path | returns the redirected home |
| `bun test packages/utils/src/command-executor/execute-hook-command.test.ts` | 6 tests | 7 pass / 0 fail, exit 0 |
| `bun run typecheck` | - | exit 0 |

## Mutation proof

Reverting `execute-hook-command.ts` to `upstream/dev` and rerunning the file gives 6 pass / 1 fail (`mutation-revert-fix.log`):

```
Expected: "...\omo-hook-home-TIpBqT"
Received: "...\omo-hook-decoy-HVLFxc"
```

The test sets `HOME` to a sandbox and `USERPROFILE` to a separate decoy directory, so it does not depend on what any sibling test left in the environment, and it fails for the defect rather than for its shape. On a platform where `os.homedir()` reads `HOME`, the assertion holds before and after; the mutation is only meaningful on Windows.

## Scope

Only the home redirection. The same file's Windows behavior around a visible console window is #7144 with open PR #7258, and `cmd.exe` resolution is open PR #7205; neither is touched here.

## Local versions

node v26.1.0, bun 1.3.14, Windows 11, upstream/dev at `ad62603f0`.
