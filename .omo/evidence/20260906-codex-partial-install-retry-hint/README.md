# A failed Codex half of `--platform=both` left the user with no next step

## What was tested

Both installer surfaces, with `runCodexInstaller` stubbed to reject: the non-interactive CLI
(`runCliInstaller`) and the TUI (`runTuiInstaller`).

## What was observed

| Input | Before | After |
| --- | --- | --- |
| `--platform=both`, Codex half fails, CLI path | warning only, then the run ends with exit 0 | warning plus `bunx oh-my-openagent install --platform=codex` as the retry |
| `--platform=both`, Codex half fails, TUI path | `p.log.warn` only | `p.log.warn` plus the same retry line via `p.log.info` |
| `bun test cli-installer.platform.test.ts tui-installer-codex-installation.test.ts` | new assertions fail (1 fail per file) | 15 pass / 0 fail |

RED was captured before the production change: the added assertions failed with the existing code
(`red.log`), which is what a real user hit when `5.0.0-beta.43` failed at `sync:skills` and the run
still ended on a green "Configuration updated!" banner.

## Why it is enough

The assertions run the real installer entrypoints with the Codex installer stubbed to fail, which is
the exact branch the user hit, and they fail without the change.

## What was omitted

The exit code is deliberately unchanged: `--platform=both` still exits 0 when only the Codex half
fails, which is pinned by an existing test and is the maintainer's stated intent
("OpenCode install is still complete"). Noted for the maintainer rather than changed: the adjacent
Senpi branch returns 1 in the same situation, so the two optional harnesses disagree on partial
failure. No secrets appear in the logs.
