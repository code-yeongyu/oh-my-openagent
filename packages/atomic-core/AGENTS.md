# atomic-core

Harness-neutral integration with the optional [Atomic](https://github.com/atomicdotdev/atomic) CLI.
Adapters reach Atomic only through this package and only after the user enables `atomic` in the
user-scoped `omo.json` (see `omo-config-core` `resolveOmoAtomicPolicy`).

## Boundaries

- Depends on `omo-config-core` and `zod` only. Never imports a harness adapter, never reads
  `process.env`, and never uses `Bun.*` process or file APIs (Node APIs only, so Node bundles work).
- Never runs `atomic init`, `identity new`, `agent enable`, `record`, `add`, index upgrades, view
  switching or remote pushes. No `run(args)` escape hatch is exported.

## Modules

| Module | Owns |
|---|---|
| `process.ts` | The injectable spawn port and its Node implementation: `shell: false`, `windowsHide`, concurrent stdout/stderr draining with a 2 MiB per-stream cap, SIGTERM then SIGKILL after 1 s on timeout, abort or overflow, resolution only after `close` |
| `errors.ts` | `AtomicError` and the closed code list; retryability is false whenever side effects may have happened |
| `contracts/` | zod contracts for every wrapped JSON output, the stderr diagnostic forms, text parsers, version gate, hook verb tables |
| `client-runner.ts` | The single argv executor: outcome-to-error mapping, version gate for mutations, repository-relative path guard |
| `client*.ts` | Typed command groups (vcs, query, vault, intent, agent) assembled by `createAtomicClient` |
| `executable.ts` | Executable resolution: `binary_path`, else PATH without empty, relative or repository-internal segments |
| `probe.ts` | `probeAtomic`: `disabled`, `unauthorized`, `ready` or `unavailable` with a typed error |

## Contracts

- Version gate: 0.22.1 and later 0.22.x are supported. Older releases are refused. Newer families are
  degraded: reads run while their output validates, mutations raise `version_unsupported`.
- User-supplied values go after `--` or as `--option=value`, so a leading dash is never a flag.
- JSON outputs must be one whole document matching the pinned contract; an `error` object fails even
  with exit 0. A usage block (`error: <code>` with `cmd:`/`got:`/`usage:` lines) fails regardless of
  the exit code. Exit 3 is `not_repository`.
- Text mutations are verified by a typed read: `intent new` and `intent update` confirm through
  `intent list`, and a mismatch is `operation_indeterminate`. `intent validate` exits 0 for both
  verdicts, so its `conforms:` line is parsed into a typed result.
- Hook dispatch sends the payload on stdin; every OpenCode verb and the Codex `stop` verb add
  `--foreground`, as Atomic's own integrations do.
- Lifecycle begin/renew/end, sandbox creation, view deletion and `insert` arrive with the workspace
  modules after Gate B; context and recording services arrive in the next PR.

## Fixtures

`src/__fixtures__/0.22.1/` holds exact CLI stream bytes and hook payloads captured from Atomic 0.22.1 in
disposable repositories with a fresh HOME. Machine paths, project ids and DIDs are replaced with
placeholders; content hashes are from the synthetic runs and carry no meaning. Files ending in
`.stderr.txt` are stderr; other `.txt` files are stdout; `<agent>-<verb>.json` are hook stdin payloads.

## Verification

`bun test packages/atomic-core/src` needs no Atomic binary: client and probe tests replay fixtures
through the spawn port, and process tests drive real child processes of the test runtime.
Typecheck: `bun check --no-script --all -p packages/atomic-core/tsconfig.json`.
