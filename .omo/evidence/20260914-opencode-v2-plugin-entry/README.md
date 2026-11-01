# OpenCode V2 plugin entry compatibility QA

## Focused regression

Command:

```sh
PATH=/Users/duan/.proto/tools/node/24.12.0/bin:$PATH \
  /Users/duan/.proto/tools/bun/1.4.2/bun test --timeout 20000 \
  packages/omo-opencode/src/testing/create-plugin-module.test.ts
```

Result: 16 passed, 0 failed, 42 assertions.

## Typecheck

Command:

```sh
PATH=/Users/duan/.proto/tools/node/24.12.0/bin:$PATH \
  /Users/duan/.proto/tools/bun/1.4.2/bun run typecheck
```

Result: passed.

## Build and repository test suite

`bun run build` compiled `dist/index.js`, then failed in the unrelated Senpi
packaging step because
`packages/omo-senpi/plugin/extensions/omo.js.meta.json` was absent. An initial
build attempt also hit the sandboxed default Bun temporary directory; the
second attempt used a writable cache and reached the Senpi step.

The root `bun test --timeout 20000` run was stopped after several minutes at
the implementation owner's direction once it had exercised the changed test
successfully and exposed unrelated environment/generated-artifact failures.
Observed failures included the missing Senpi generated metadata/assets, a
native bundle-size baseline over its limit, tests attempting to create
temporary directories under `/Users/duan`, and native embedded-payload probes
selecting the older Bun shim on `PATH`. The focused test and typecheck results
above are the validation specific to this change.

## Real OpenCode V2 loader QA

The repository's `opencode-qa` procedure was run with a temporary isolated
OpenCode v2.0.3 installation and temporary `HOME`/XDG directories. The tested
configuration is preserved in `opencode.json` and points to this worktree's
built `dist/index.js`.

A real tmux-backed TUI launch rendered OpenCode `2.0.3`. Its logs reported
`plugin reconciliation completed` with `plugins=11 role=cli`, and did not
contain the prior `missing setup/effect` schema error. The real user database
path `/Users/duan/.local/share/opencode/opencode.db` was absent before and
after the run.

## Compatibility boundary

The added `setup` entrypoint makes the default export acceptable to the V2
loader while retaining the existing V1 `server` entrypoint. It does not port
the V1 hooks and tools to OpenCode V2 domain APIs.
