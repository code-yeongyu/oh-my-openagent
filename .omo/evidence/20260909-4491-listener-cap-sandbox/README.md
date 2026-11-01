# PR #4491 - listener cap in an isolated OpenCode sandbox (#4334)

Evidence for `fix(process): raise listeners cap at module load to quiet plugin-hook warning (#4334)`.
Run on 2026-09-09 (UTC 08:01-08:11) against OpenCode 1.18.21 (bun-compiled binary).

## Purpose

The reviewer approved the code and deferred merge on two gates (quoted):

1. "Add reviewer-readable evidence under `.omo/evidence/` that boots the real plugin in an isolated
   OpenCode sandbox, exercises the listener-producing startup/session surface, records the effective
   process cap, shows no `MaxListenersExceededWarning`, and confirms cleanup returns listener counts
   to the baseline".
2. The evidence must prove the warning is suppressed "without hiding an unbounded listener leak".

This folder answers gate 1 with measured data. For gate 2 it gives a bounded, flat listener profile
plus a negative control, but the control has a runtime limitation described candidly below.

## Method

- **Sandbox.** `run-sandbox.sh` builds a throwaway XDG root (`oqa_mk_isolated_xdg`, `/tmp/oqa-xdg.*`,
  removed on exit) with its own `XDG_CONFIG_HOME` / `XDG_DATA_HOME` / `TMPDIR`. The real
  `~/.config/opencode` and `~/.local/share/opencode` are never touched; the real session DB row count
  is recorded before/after in every `receipt-*.txt` (`real_db_sessions_before=591`,
  `real_db_sessions_after=591`, `real_db_unchanged=yes`).
- **Fake LLM.** `.agents/skills/opencode-qa/scripts/lib/fake-openai-server.mjs` on a random loopback
  port; the sandbox `opencode.jsonc` (from `opencode.jsonc.template`) points provider `openai` at it
  with model `gpt-fake`. No network, no real model. Calls are logged in `fake-llm-*.log`.
- **Plugin under test.** The real entry `packages/omo-opencode/src/index.ts` is loaded from source via
  `file://` from one of two READ-ONLY trees (see `tree_head` in each receipt):
  - `before` = `worktrees/dev-ro` at `dc9bf86e4` (upstream dev, no `raise-process-listeners-cap.ts`),
  - `after`  = `worktrees/4491-pr` at `4e681b302` (PR head merged with upstream/dev,
    `PROCESS_LISTENERS_CAP_DEFAULT = 128`).
- **Probe.** `listener-probe.mjs` is a second, dependency-free plugin listed after the real one. It
  appends one JSON line per sample to `probe-<label>.jsonl` with `process.getMaxListeners()`,
  `process.listenerCount()` for `exit`, `beforeExit`, `SIGINT`, `SIGTERM`, `SIGHUP`,
  `uncaughtException`, `unhandledRejection`, `warning`, and `process.eventNames().length`. Samples are
  taken at module import (before any plugin's `server()` runs), at its own `server()` init, on every
  plugin `event`, every 500 ms, at `dispose`, and at process `exit`. It attaches a `process.on("warning")`
  listener at import and flags any `MaxListenersExceededWarning`. The probe itself owns exactly two
  process listeners (`warning`, `exit`), which are included in the counts.
- **Surface exercised.** `opencode serve` -> `GET /agent` (instance bootstrap, real plugin loads, 17
  agents registered incl. omo `explore,librarian,oracle`) -> N sessions created and prompted via
  `prompt_async`, waited to completion -> all sessions aborted + deleted -> `opencode run "hi"` twice as
  separate processes in the same sandbox -> `POST /global/dispose` (plugin `dispose` hook) -> SIGTERM.
  The driver writes the current phase to a side file so every probe sample carries a phase label.
- **Leak control.** `--leak N` makes the probe add N no-op `SIGHUP` listeners to `process` at
  server-init and remove them at dispose, to check whether a real over-cap accumulation is visible.
- **Reproduce** (from this folder; the fake LLM and `oqa_*` helpers come from the repo's
  `.agents/skills/opencode-qa`):
  ```
  ./run-sandbox.sh --label before --tree ../../../../dev-ro            # 6 sessions, 2 runs
  ./run-sandbox.sh --label after  --tree ../../..                      # 6 sessions, 2 runs
  ./run-sandbox.sh --label before-leak12 --tree ../../../../dev-ro --sessions 2 --runs 0 --leak 12
  ./run-sandbox.sh --label after-leak12  --tree ../../..               --sessions 2 --runs 0 --leak 12
  ./run-sandbox.sh --label after-leak130 --tree ../../..               --sessions 2 --runs 0 --leak 130
  ```
  `summarize.mjs` turns each `probe-*.jsonl` into `summary-*.md` / `summary-*.json`.

## Results

### Effective process cap (`process.getMaxListeners()`), from `summary-before.md` / `summary-after.md`

| process | module import | server-init | exit |
|---|---|---|---|
| before: `opencode serve` (pid 1229807) and both `opencode run` | 10 | 10 | 10 |
| after: `opencode serve` (pid 1211460) and both `opencode run` | 10 | 128 | 128 |

The `after` value at module import is 10 because the PR raises the cap as the first step of the
plugin's `server()` entry (`createPluginModule` -> `raiseProcessListenersCap(128)`), which runs before
the probe's `server()` but after the probe module is evaluated. The cap is therefore raised before any
session work and stays 128 through dispose and exit. `cap_constant_in_tree` in `receipt-after*.txt`
confirms the constant in the tree under test; the `before` tree has no such file.

### `MaxListenersExceededWarning`

| variant | probe `warning` events | `serve-*.stderr/stdout` | `run-*-N.stderr/stdout` |
|---|---|---|---|
| before | 0 | 0 (stderr empty) | 0 |
| after | 0 | 0 (stderr empty) | 0 |
| before-leak12 / after-leak12 / after-leak130 | 0 | 0 | n/a (`--runs 0`) |

Source: `max_listeners_warning_*` lines in each `receipt-*.txt`; `grep MaxListeners` over every
`probe-*.jsonl`, `serve-*.txt`, `run-*.txt` returns 0 matches.

### Per-event `process` listener counts (serve process; identical for before and after)

| event | import | server-init | peak (any phase) | last `disposed` | exit |
|---|---|---|---|---|---|
| exit | 1 | 2 | 2 | 2 | 2 |
| beforeExit / SIGINT / SIGTERM / uncaughtException / unhandledRejection | 0 | 1 | 1 | 1 | 1 |
| SIGHUP | 0 | 0 | 0 | 0 | 0 |
| warning | 1 | 1 | 1 | 1 | 1 |

`process.eventNames().length`: 2 at import, 7 from server-init through exit. 6 sessions
(create/prompt/complete/delete, 6 fake-LLM calls) plus 271 plugin `event` deliveries and two `opencode
run` processes (74 events each) added **no** process listeners in either build: the peak equals the
post-init level, and the level is unchanged after `sessions-deleted`, after `/global/dispose`
(HTTP 200, dispose hook called once) and at exit. Import-time counts (1 `exit`, 1 `warning`) are the
probe's own listeners.

### Leak controls (`summary-*-leak*.md`, `probe-*-leak*.jsonl`)

| variant | cap | SIGHUP after injection | SIGHUP at `dispose` | warning captured |
|---|---|---|---|---|
| before-leak12 | 10 | 12 | 0 (12 removed) | 0 |
| after-leak12 | 128 | 12 | 0 (12 removed) | 0 |
| after-leak130 | 128 | 130 | 0 (130 removed) | 0 |

## Interpretation

- Gate 1, cap: the PR's effect is visible in the live binary - 10 in the unpatched build, 128 in the
  patched build from the first plugin init onward, in the server and in both CLI processes.
- Gate 1, warning: no `MaxListenersExceededWarning` in the `after` runs. Note that none appeared in the
  `before` runs either: this `serve` + HTTP-session + `opencode run` surface, with ~2 process listeners
  per event, is far below either cap, so the runs demonstrate "no warning and no regression", not
  "warning reproduced, then suppressed". The report in #4334 came from `opencode web` on OpenCode
  1.15.7 and names an EventTarget inside OpenCode's effect runtime (~58 hook registrations), which this
  sandbox did not reproduce.
- Gate 1, cleanup: process listener counts are flat from server-init to exit, so there is no
  accumulation to shed; the post-init level is held through session deletion and dispose.
- Gate 2 (not hiding an unbounded leak): the bounded profile above is the strongest evidence here. The
  injected listeners are removed by the dispose path (N -> 0 in every control), which shows the probe's
  counting and cleanup are real. However the controls do **not** show that exceeding the cap still
  warns - see limitations.

## Limitations (read before citing)

1. **Bun's `process` never emits `MaxListenersExceededWarning`.** No control produced a warning, not
   even `before-leak12` (12 listeners on a cap of 10). Checked outside the sandbox with a standalone
   Bun 1.3.12: `process.on("SIGHUP", fn)` 12 times prints nothing and fires no `warning` event,
   `process instanceof EventEmitter` is `false`, while the same loop on `new EventEmitter()` warns as
   expected; Node 24 warns for `process` (once per emitter+event). OpenCode 1.18.21 embeds Bun v1.3.14
   (`strings` on the binary), so in the runtime under test `process.setMaxListeners(128)` changes the
   number the probe reads but is not what decides whether a warning prints. Consequently
   `after-leak130` (130 > 128) is **not** a demonstration that a leak past the cap still warns; it only
   demonstrates injection and removal. The probe's `warning` capture path was never positively
   exercised in these runs. The `bun_version=1.4.2` line in the receipts is the standalone `bun` on the
   driver's PATH at run time, not the runtime inside the OpenCode binary.
2. **Warning not reproduced in `before`.** See interpretation; the evidence is about the process cap
   and the absence of process-listener growth, not about the EventTarget named in #4334.
3. **Instance re-created after dispose in the leak runs.** In all three `*-leak*` runs OpenCode
   re-bootstrapped the project instance about 0.3 s after `POST /global/dispose` (a second `server-init`
   record in phase `disposed`, e.g. `probe-after-leak130.jsonl` 08:11:03.169 dispose -> 08:11:03.481
   server-init), so the probe re-injected N listeners and the `last disposed` / `exit` columns of
   `summary-*-leak*.md` read N, not 0. The `dispose` record itself shows 0. This did not happen in the
   plain `before` / `after` runs (one server-init, one dispose per process).
4. Small surface: 6 (or 2) sessions, 2 CLI runs, fake model, no tools, no `opencode web`/TUI, one
   machine (Linux 7.0, x86_64). Listener-count claims are scoped to this surface.

## File index

- `run-sandbox.sh` driver; `opencode.jsonc.template` sandbox config; `listener-probe.mjs` probe plugin;
  `summarize.mjs` reducer.
- Per variant `<label>` in {`before`, `after`, `before-leak12`, `after-leak12`, `after-leak130`}:
  `probe-<label>.jsonl` raw samples; `summary-<label>.md` / `.json` reduced tables;
  `receipt-<label>.txt` versions, tree heads, isolation receipt, session/dispose counts, warning greps;
  `harness-<label>.log` timeline; `serve-<label>.stdout.txt` / `.stderr.txt` server stdio (stderr empty);
  `fake-llm-<label>.log` fake model calls; `omo-log-<label>.txt` plugin `ENTRY - plugin loading` lines.
- `run-{before,after}-{1,2}.stdout.txt` / `.stderr.txt`: `opencode run --format json` output (stderr empty).
- Paths are scrubbed (`$HOME`), server password redacted.
