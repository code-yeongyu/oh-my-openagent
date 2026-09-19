---
name: codebuddy-qa
description: "Live CodeBuddy QA for the omo-codebuddy adapter: drives the bundled hook bundle with real CodeBuddy payloads, proves format parity against the plugins CodeBuddy actually loads, runs a full install/uninstall cycle inside a throwaway CodeBuddy root, and records reviewer-readable evidence. Use whenever a change touches packages/omo-codebuddy (hooks, protocol, generators, installer, plugin manifest) or the CodeBuddy plugin surface."
---

# CodeBuddy QA

The QA gate for `packages/omo-codebuddy`. A change there reaches a real
CodeBuddy session, so **typecheck + `bun test` is not QA**: you must drive the
built plugin with real payloads and write evidence to disk.

## Hard rules

1. **NEVER touch the real `~/.codebuddy`.** Every script installs into a
   throwaway `--root`, and the driver digests the real
   `~/.codebuddy/settings.json` + `plugins/known_marketplaces.json` before and
   after. A changed digest is a FAILED run, not a footnote.
2. **NO EVIDENCE FILE == NO QA == NO COMMIT.** Write everything under
   `.omo/evidence/<YYYYMMDD>-<slug>/`.
3. **Do not claim live CLI validation you did not run.** On machines where
   `codebuddy` resolves to the IDE launcher (`buddycn`, a VS Code fork) there is
   NO `plugin` subcommand: `drive.mjs probe` reports
   `kind: "ide-launcher"` / `agentCliAvailable: false`, and a
   `codebuddy plugin validate …` invocation through it exits 0 while doing
   nothing. Report that as a SKIP, never as a pass. The interactive
   `--plugin-dir` / `/reload-plugins` checks are then the USER's manual step and
   must be listed as pending, not claimed.

## Run

```bash
cd "$(git rev-parse --show-toplevel)"
D=".agents/skills/codebuddy-qa/scripts/drive.mjs"
EV=".omo/evidence/$(date +%Y%m%d)-<slug>"; mkdir -p "$EV"

bun packages/omo-codebuddy/scripts/build-plugin.mjs            # rebuild first
node "$D" --self-test                | tee "$EV/00-self-test.json"
node "$D" isolation                  | tee "$EV/01-isolation-before.json"
node "$D" hooks                      | tee "$EV/02-hooks.json"
node "$D" probe                      | tee "$EV/03-probe.json"
node "$D" format-parity              | tee "$EV/04-format-parity.json"
node "$D" install                    | tee "$EV/05-install-cycle.json"
node "$D" isolation --root <throwaway> | tee "$EV/06-isolation-after.json"
```

Plus the hermetic gate, which CI runs:

```bash
bun test packages/omo-codebuddy
(bunx tsgo --noEmit -p packages/omo-codebuddy/tsconfig.json)
```

### Live CodeBuddy Code CLI (when `codebuddy` is the agent CLI)

The agent CLI is `npm install -g @tencent-ai/codebuddy-code` (bin
`codebuddy`/`cbc`, and it must be the FIRST candidate in
`candidateBinaries()` — the IDE launcher `buddycn` has no `plugin`
subcommand and would fake a pass). With it, run the FULL plugin lifecycle
against an isolated `--home`:

```bash
TMPH=$(mktemp -d)
bun packages/omo-codebuddy/scripts/install-local.mjs install --root "$TMPH/.codebuddy" --json
node "$D" cli --home "$TMPH" --args "plugin marketplace add $TMPH/.codebuddy/plugins/omo-local"
node "$D" cli --home "$TMPH" --args "plugin install omo@omo-local"
node "$TMPH" # (evidence) plugin list --json → id/version/scope/enabled/installPath
node "$D" cli --home "$TMPH" --args "plugin uninstall omo@omo-local"
node "$D" cli --home "$TMPH" --args "plugin marketplace remove omo-local"
rm -rf "$TMPH"
```

`plugin validate`, `marketplace add`, `install`, `list`, `uninstall` and
`marketplace remove` all work WITHOUT authentication. A live TURN
(`codebuddy -p "…"`) does not: it answers
`Authentication required. Please use /login command` unless the operator has
signed the CLI in, and no env var or copied file substitutes for that. Report
the turn as PENDING with that exact message; never as a pass.

**The marketplace source must live INSIDE the marketplace root.** A symlinked
plugin dir is rejected at install time with `Plugin source path escapes
marketplace root` — the installer therefore COPIES by default.

## What each subcommand proves

| Subcommand | Proof |
|---|---|
| `--self-test` | the driver itself works: plugin dir, bundled hook present, hook runs, ultrawork injection, silence without a trigger |
| `isolation` | sha256 of the real profile files — run it before AND after and compare |
| `hooks` | real payloads → the BUILT bundle: `UserPromptSubmit` injects `hookSpecificOutput.additionalContext` (ultrawork + skill pointer), `SessionStart` injects memory/workflows, `Stop` is silent with no state, `PostToolUse` is silent without the checker binary, and `stop_unfinished_work` returns `{"continue":false,"reason":…}` for an unfinished Boulder plan owned by `codebuddy:<session>` |
| `probe` | which binary is on PATH, its version, and whether it is the IDE launcher or a real agent CLI (no faking a pass) |
| `format-parity` | our `plugin.json` keys and `hooks.json` event names are a subset of what the installed marketplaces use — an unknown key/event means the format drifted |
| `install` | full cycle in a throwaway root: install → the INSTALLED copy's hook runs → uninstall → root clean and the settings entry gone |
| `cli --home <dir> --args "plugin …"` | drives the real CodeBuddy Code CLI against a throwaway profile: `validate` passes, `marketplace add` + `plugin install` succeed, `plugin list --json` shows `enabled: true` with an `installPath` under the throwaway profile's versioned cache |

## Evidence contents

Each evidence directory must state:

- **What was tested** — command, surface driven, behaviour it was meant to prove.
- **What was observed** — the captured JSON, plus the before/after digests.
- **Why it is enough** — how the evidence covers the intended behaviour and what
  regression risk remains.
- **What was omitted** — redact raw secrets; never copy `~/.codebuddy/mcp.json`
  or any credentials into evidence.

## Manual steps to hand the user (cannot be automated here)

1. **Sign the CLI in** (`codebuddy` → `/login`), then run a live turn:
   `node "$D" session --home real --debug hooks --prompt "ulw probe: reply with exactly ULTRAWORK MODE ENABLED! and nothing else."`
   — that is the only way to observe the hook context reaching a model. Until
   then, report it as PENDING, not as a pass.
2. In the IDE: install through the local marketplace
   (`/plugin marketplace add <path>`, `/plugin install omo@omo-local`) and check
   `/hooks`, `/agents`, `/plugin`.
3. Re-run `/reload-plugins` after a rebuild.
