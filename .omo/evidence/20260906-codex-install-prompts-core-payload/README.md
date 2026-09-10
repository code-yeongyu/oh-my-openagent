# Codex install dies at `npm run sync:skills` on the published oh-my-openagent payload

## What was tested

The packaged Codex install path, driven from the REAL published npm tarballs against a fully
isolated `CODEX_HOME`, to prove that `oh-my-openagent@5.0.0-beta.43` cannot install its Codex
plugin while `lazycodex-ai@5.0.0-beta.43` can.

- Driver: `repro-install.mjs` (imports the published `packages/omo-codex/scripts/install-dist/install-local.mjs`
  and calls `installMarketplaceLocally` with `CODEX_HOME` and `CODEX_LOCAL_BIN_DIR` pointed at temp dirs).
- Payload inspection: `tar -tzf <tarball> | grep prompts-core`.
- Unit: `bun test script/npm-payload-containment.test.ts`.

## What was observed

| Input | Before | After |
| --- | --- | --- |
| `tar -tzf oh-my-openagent-5.0.0-beta.43.tgz \| grep prompts-core` | 0 paths | 1 path (`npm pack --dry-run` on this branch) |
| `tar -tzf lazycodex-ai-5.0.0-beta.43.tgz \| grep prompts-core` | 1 path | 1 path (unchanged control) |
| packaged install from the base tarball | `RESULT: FAILED npm run sync:skills ... exit code 1` (`red-packaged-install.log`) | `RESULT: ok installed=1`, 26 skills materialized (`green-packaged-install.log`) |
| `bun test script/npm-payload-containment.test.ts` | 5 pass / 1 fail | 6 pass / 0 fail |

The GREEN run differs from the RED run by exactly one file: the canonical directive copied into the
extracted tarball at `packages/prompts-core/prompts/ultrawork/codex.md`. No installer code changed
between the two runs.

Isolation proof: `~/.codex/config.toml` SHA256 was `02C24C5C0098E41A96B02B86C21F16584217E3A3CFF9725CFD3A434429311B4C`
before and after every run; both installs wrote only into their own sandbox `CODEX_HOME`.

## Why it is enough

The RED artifact is the published tarball itself, so the failure does not depend on this checkout,
this machine, or this OS. The lazycodex-ai control isolates the defect to the base package's
`files` allowlist rather than to `sync-skills.mjs` or the cache installer, and the single-file delta
between RED and GREEN pins the root cause to that omission.

## What was omitted

No secrets, tokens, or credentials appear in the captured logs; the logs contain local absolute
sandbox paths only. The GREEN log still shows an unrelated
`Warning: skipped OMO SOT seed/migration` line, which is a separate defect and is deliberately not
addressed here.
