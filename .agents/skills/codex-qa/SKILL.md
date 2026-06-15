---
name: codex-qa
description: "QA the omo Codex Light edition (lazycodex / packages/omo-codex) itself, in strict isolation so ONLY our plugin is exercised, never the user's real ~/.codex. The first-party method drives the real `codex app-server` against an isolated CODEX_HOME plus a LOCAL mock model (no real API call), and proves a plugin hook fired by asserting hook/started + hook/completed notifications. Also: isolated install verification, per-component hook probes, a tmux TUI smoke, and runtime log observation (RUST_LOG / logs SQLite / /debug-config). Ships tested helper scripts each with a --self-test. Use whenever someone changes anything under packages/omo-codex or wants to QA, smoke-test, verify, or debug the Codex plugin, its hooks/components, the installer/config.toml, the app-server flow, or the Codex TUI. Triggers: codex qa, qa codex, codex-qa, test codex plugin, verify codex hook, codex app-server, lazycodex qa, isolated CODEX_HOME, prove codex hook fired, codex tui test."
---

# Codex QA

QA the omo Codex Light edition (`packages/omo-codex/`, shipped as lazycodex). We
exercise OUR plugin in a REAL Codex while touching nothing of the user's setup:
an isolated `CODEX_HOME` + a local mock model means no real API call and the real
`~/.codex` is never read or written. Each helper script ships a `--self-test`
that asserts its scenario against the live machine, so the scripts are both the
QA tools and their own regression checks.

Verified against `codex-cli 0.139.0` (node, jq, tmux, bun on macOS). Confirm with
`codex --version`; check a flag with `codex <cmd> --help`.

## Golden rules (read before running anything)

- **QA ONLY our plugin.** Everything that spawns codex uses an isolated
  `CODEX_HOME` (created by `cqa_mk_isolated_home`) and a LOCAL mock model
  provider (`cqa_start_mock`). Never QA against the real `~/.codex`, never hit a
  real model API. The bundled scripts enforce this; if you run codex by hand,
  `export CODEX_HOME="$(mktemp -d)/codex"; mkdir -p "$CODEX_HOME"` FIRST (a set
  `CODEX_HOME` must already exist or codex hard-errors).
- **Prove the real home stayed clean.** Every script shasums
  `~/.codex/config.toml` before and after and asserts it is unchanged. If you
  script by hand, do the same.
- **The interactive `codex` is a shell function** that injects `--profile quotio`.
  Bash scripts bypass it and get the real binary; never rely on the interactive
  alias. See [references/isolation.md](references/isolation.md).
- **The first-party way to prove a hook fired is the app-server** notification
  stream (`hook/started` / `hook/completed`), not log scraping. See
  [references/app-server.md](references/app-server.md).
- **The captured JSON / pane IS the evidence** — write it under
  `.omo/evidence/<YYYYMMDD>-<slug>/` (no evidence file == the QA did not happen).

## Setup

```bash
cd <this-skill-dir>                        # .agents/skills/codex-qa
bash scripts/lib/common.sh --self-check    # confirm deps + isolation harness
```

## Router: pick your case

| You need to… | Run | Deep dive |
|---|---|---|
| Prove a plugin hook fires in a LIVE Codex turn (first-party) | `scripts/app-server-drive.sh --plugin` | [app-server.md](references/app-server.md) |
| Prove the app-server driver itself works (no plugin, fast) | `scripts/app-server-drive.sh --self-test` | [app-server.md](references/app-server.md) |
| Install the LOCAL build into an isolated home + assert it landed | `scripts/install-verify.sh --self-test` | [install-verify.md](references/install-verify.md) |
| Pin ONE component's hook logic deterministically (no codex) | `scripts/hook-unit-probe.sh --self-test` | [components-hooks.md](references/components-hooks.md) |
| Smoke the real TUI under tmux (boots, renders, survives) | `scripts/tui-smoke.sh --self-test` | [logging-debug.md](references/logging-debug.md) |
| Watch runtime logs while QAing | (see reference; RUST_LOG / logs DB / `/debug-config`) | [logging-debug.md](references/logging-debug.md) |

## Scripts index (each is its own regression test)

| Script | `--self-test` asserts |
|---|---|
| `scripts/lib/common.sh --self-check` | deps present; isolated `CODEX_HOME` is created inside a sandbox and auto-removed on exit; mock model serves the Responses SSE; real `~/.codex` unchanged |
| `scripts/app-server-drive.sh` | `--self-test`: a bare turn completes and the mock assistant text comes back. `--plugin`: installs local omo, drives a turn, and asserts `hook/completed` for `sessionStart,userPromptSubmit` |
| `scripts/install-verify.sh` | local omo installs into the isolated home; `config.toml` enables `omo@sisyphuslabs`; component bins + agent TOMLs linked in the sandbox; real `~/.codex` unchanged |
| `scripts/hook-unit-probe.sh` | the `ultrawork` component injects `<ultrawork-mode>` on an `ulw` UserPromptSubmit (also a manual `--component/--event` mode) |
| `scripts/tui-smoke.sh` | the real codex TUI boots in the isolated home, renders, and survives (no early exit); captures the pane |

## Match QA to your change scope

- **Component / hook logic** (`packages/omo-codex/plugin/components/*`):
  `hook-unit-probe.sh` for the exact stdout, THEN `app-server-drive.sh --plugin`
  to prove the live wiring. See [components-hooks.md](references/components-hooks.md).
- **Installer / config.toml** (`packages/omo-codex/src/install/*`):
  `install-verify.sh`.
- **Anything that affects a live session** (hooks, agents, MCP wiring):
  `app-server-drive.sh --plugin`, and `tui-smoke.sh --plugin` if the TUI path
  matters.

## Capturing evidence

```bash
ev=".omo/evidence/$(date +%Y%m%d)-codex-qa-<slug>"; mkdir -p "$ev"
bash scripts/app-server-drive.sh --plugin > "$ev/app-server-drive.json" 2>&1
bash scripts/install-verify.sh --self-test > "$ev/install-verify.txt" 2>&1
```

## On `/debugging`

There is no `/debugging` command in Codex. To observe a run: the app-server
notification stream (above), `RUST_LOG=debug` on the app-server's stderr, the
logs SQLite under `$CODEX_HOME`, the TUI's `/debug-config`, and the
`codex debug …` subcommands. See [logging-debug.md](references/logging-debug.md).
