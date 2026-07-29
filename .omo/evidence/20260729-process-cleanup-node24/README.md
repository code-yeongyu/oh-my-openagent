# Process cleanup Node 24 declaration compatibility evidence

## Scope

The declaration build failed when `bun-types@1.3.14` resolved its wildcard
`@types/node` dependency to 24.12.0. The unused `getNewListener` helper mixed
event-specific process listener overloads into a single `() => void` contract.

## RED / GREEN

- Compatibility compiler:
  `/tmp/omo-node-types-24/node_modules/.bin/tsc -p /tmp/omo-node-types-24/tsconfig.json`
- Before the fix: exit 1 with TS2769 and TS2322. See `red-node24.txt`.
- After the fix: exit 0 with no diagnostics. See `green-node24.txt`.
- Current dependency declaration emit:
  `/tmp/omo-process-cleanup-pr/node_modules/.bin/tsc -p /tmp/omo-process-cleanup-pr/tsconfig.json --emitDeclarationOnly`
  exited 0.

## Automated verification

- `bun test /tmp/omo-process-cleanup-pr/packages/omo-opencode/src/features/background-agent/process-cleanup.test.ts`
  - Result: PASS - 44 tests, 0 failures, 83 expectations.
- `bun install` in the patched isolated worktree
  - Result: PASS - full prepare build completed.
- `bun run build:senpi-plugin` in the patched isolated worktree
  - Result: PASS - Senpi extension and LSP runtime built successfully.
- `bun install` in `/home/thewind/.local/share/oh-my-openagent`
  - Result: PASS - exact installed-checkout update surface completed.
- `bun run build:senpi-plugin` in `/home/thewind/.local/share/oh-my-openagent`
  - Result: PASS - exact installed-checkout Senpi plugin build completed.
- `bun install` in Senpi's generated updater worktree after applying the patch
  - Result: PASS - exact worker dependency/build environment reported
    `build: all steps completed`.

## Why this is sufficient

The compatibility compiler reproduces the exact diagnostics and line locations
from the failed updater. Removing the zero-consumer helper makes the same
compiler surface pass without changing production cleanup behavior. The focused
cleanup suite verifies all used signal and shutdown helpers remain intact, and
the install/build commands exercise the package scripts used by `senpi update`.

## Senpi update command

`senpi update` exited 0 and launched its OMO update worker. The worker correctly
continued to fail while building unpatched `origin/dev`; its log reproduced the
same TS2769/TS2322 diagnostics. Applying this patch to that generated worktree
made its exact `bun install` command pass. The background update will therefore
remain blocked for users until this change reaches `dev`.

## Live QA

The repository wrapper scripts could not reach their assertions in this host
environment: the default mode blocked while copying the unrelated host Codex
profile, and `--no-config` blocked in its unbounded readiness curl. Both
disposable containers were forcibly removed before continuing.

The equivalent bounded HTTP smoke ran against a direct disposable `omo-qa`
container:

- Container command:
  `docker run --rm --name omo-process-cleanup-qa -p 127.0.0.1:56609:56609 -e OPENCODE_SERVER_PASSWORD=omo-qa omo-qa opencode serve --port 56609 --hostname 0.0.0.0`
- Authenticated `GET /global/health`: HTTP 200,
  `{"healthy":true,"version":"1.18.9"}`.
- Authenticated `GET /doc`: 162 documented paths.
- Unauthenticated `GET /session?directory=/tmp/omo-qa`: HTTP 401.
- Cleanup: `docker rm -f omo-process-cleanup-qa`; no matching container
  remained and port 56609 refused connections.

See `live-opencode-qa.txt` for the exact probes and results.
