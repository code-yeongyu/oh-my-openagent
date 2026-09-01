# RED - Windows clean install race

## What was tested

Public GitHub Actions run 31365002433 executed this command in the real `windows-latest` job from a clean checkout:

```powershell
bun install --frozen-lockfile
```

## What was observed

```text
npm error code ENOTEMPTY
npm error syscall rmdir
npm error path ...\packages\omo-codex\plugin\node_modules\undici-types
npm --prefix packages/omo-codex/plugin ci failed
error: script "build:senpi-plugin:stage" exited with code 1
```

An earlier post-merge run failed on the same tree under `postcss\lib`. Other log sections included `TAR_ENTRY_ERROR` and `ENOENT` while packages were being extracted. The downstream root test step was skipped.

Raw run:
https://github.com/code-yeongyu/oh-my-openagent/actions/runs/31365002433

## Why this is enough

The failure occurs during a clean install before tests. Both the root Codex build and Senpi toolkit staging can invoke `npm ci` against `packages/omo-codex/plugin/node_modules` in the same build wave, which directly explains concurrent deletion and extraction failures.

## What was omitted

Unrelated successful step output and repetitive npm tar warnings were summarized. No secrets, auth headers, or environment dumps were copied.
