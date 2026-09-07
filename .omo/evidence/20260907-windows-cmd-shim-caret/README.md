# Generated .cmd shims abort on Windows when NODE_REPL_NODE_PATH is set, 2026-09-07

Issue #7473, open since 2026-08-29 with no PR fixing it. Every generated `.cmd` entry point dies before it reaches its target on any machine where `NODE_REPL_NODE_PATH` is present in `config.toml`, which is what Codex Desktop writes by default.

## Failing input, against upstream/dev at ad62603f0

Generate the shim, put a `NODE_REPL_NODE_PATH` line in `config.toml`, and run it (`red-shim-run.log`):

```
exit 255
stderr: The syntax of the command is incorrect.
```

The target never runs.

## Mechanism

`windowsNodeDiscoveryLines()` strips surrounding quotes with two caret-escaped comparisons:

```
if "!OMO_NODE_BINARY:~0,1!"=="^"" set "OMO_NODE_BINARY=!OMO_NODE_BINARY:~1!"
```

`^"` is only a valid quote escape at the cmd top level. These two lines sit inside the `if defined OMO_NODE_REPL_NODE_PATH (` block, and inside a parenthesized block the parser rejects the whole construct, so the script aborts before the exec line. The block is only entered when `NODE_REPL_NODE_PATH` resolves to something, which is why a machine without it never sees this.

## The fix

The trim line above it already runs the value through `for /f`, and `%%~N` strips surrounding quotes as part of the expansion. Changing `%%N` to `%%~N` removes the need for both comparisons, so they are deleted rather than escaped differently. The single-quote pair below is untouched: `"'"` needs no caret and is valid inside a block.

## RED / GREEN

| run | before | after |
| --- | --- | --- |
| generated shim under `cmd.exe`, `NODE_REPL_NODE_PATH` set | exit 255, `The syntax of the command is incorrect.` | exit 0, target prints `shim-ran hello` |
| `bun test codex-cache-command-shim.test.ts codex-cache-bins.test.ts codex-cleanup.test.ts` | 1 pre-existing failure on the caret assertion | 40 tests, 0 fail, exit 0 |
| `bun run typecheck` | - | exit 0 |
| `bun test script/codex-install-bundle-freshness.test.ts` | exit 1 before the bundle was regenerated | exit 0 |

Logs: `red-shim-run.log`, `green-shim-run.log`, `green-unit.log`, `green-typecheck.log`, `red-bundle-freshness.log`, `green-bundle-freshness.log`.

## Mutation proof

Restoring the pre-fix discovery block from `upstream/dev` and rerunning (`mutation-restore-caret.log`) fails three assertions: the shim execution under `cmd.exe`, the guard that no caret-escaped comparison is generated, and the existing runtime-wrapper parity test. 12 pass / 3 fail. The source was restored afterwards and the suites are green again.

## A test that asserted the defect

`codex-cache-bins.test.ts` line 145 required the generated wrapper to contain the broken caret line verbatim, so the defect was pinned as intended behavior and any repair would have failed CI. That assertion is replaced by its negation, and the new behavioral coverage lives in `codex-cache-command-shim.test.ts`, which runs the shim through `cmd.exe` rather than reading it.

## The generated bundle is in the diff

`packages/omo-codex/scripts/install-dist/install-local.mjs` embeds this source and `script/codex-install-bundle-freshness.test.ts` reads it from the git index, so it has to move with the change. The regeneration also carries the embedded version from `5.0.0-beta.43` to `5.0.0-beta.45`: the checked-in bundle is two releases stale, and a rebuild on a clean `dev` with no source change already produces that line.

## Local versions

node v26.1.0, bun 1.3.14, Windows 11, upstream/dev at `ad62603f0`.
