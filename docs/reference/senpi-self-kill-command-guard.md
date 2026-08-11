# senpi host self-kill (taskkill) guard — incident & PR notes

**Date:** 2026-07-31
**Status:** PR-ready (branch `fix/senpi-self-kill-command-guard`)
**Target repo:** `code-yeongyu/oh-my-openagent` (omo-senpi adapter)

---

## 1. Incident summary

In a Senpi session (`019fb3f5`, "UIUX patch recovery investigation") for the 그림수세미 project,
the agent tried to clean up stale Vite dev servers by killing every node process. Because the
senpi/omo agent runtime itself runs as a node.exe process, the command terminated the session's own
host — **the session was killed 4 times in a row**.

- Session log: 2026-07-30 16:57 ~ 2026-07-31 11:42 UTC+9 (18.7 h, 475 turns)
- Every termination was immediately preceded by a `taskkill`-family command (evidence table below)
- The session file itself is intact (all 1218 JSONL events parse cleanly)

## 2. Root cause

| Layer | Cause |
|---|---|
| Direct cause | The agent ran `taskkill /F /IM node.exe` (and PID loops over node), force-killing every node.exe — including the senpi host |
| Contributing accident | Git Bash's MSYS path conversion rewrote `/F` to `F:/`, so early attempts **silently failed**. The agent interpreted this as "the command is not working" and found syntax that actually executes (`//F`, `cmd //c`, per-PID loops) — the first success killed the host |
| Systemic gap | The harness has no guard against shell commands that terminate its own host process. The default permission preset is `full-access`, so every bash command is allowed |

### Commands immediately before each termination (verbatim from the session log)

| Time | Command | Result |
|---|---|---|
| 07-31 08:01:53 | `cd /c && cmd //c "taskkill /F /IM node.exe /T" 2>&1 \| tail -5` | session died (196 min gap) |
| 07-31 11:20:19 | `for pid in $(tasklist 2>/dev/null \| grep -i node \| awk '{print $2}'); do taskkill //F //PID "$pid" ...; done` | died (user: "system terminated") |
| 07-31 11:27:10 | same PID kill loop over all node processes | died (user: "keeps terminating") |
| 07-31 11:40:01 | same PID kill loop over all node processes | died mid-tool-call |

Each resume reloaded a ~550K-token context, the agent saw the same symptom (stale node processes +
dead 5173 server), and repeated the same command — a fatal loop.

## 3. This PR (defense layer 1: omo-senpi extension guard)

Adds a `self-kill-guard` component to `packages/omo-senpi`.

**How it works**

- Senpi loads plugin extensions (omo-senpi) **before** builtin extensions (including `terminal`), so a
  `pi.registerTool` wrapper installed by the plugin intercepts the core `bash`/`bash_input`/`monitor`
  tools at their registration time and wraps their `execute` closures.
- The wrapped `execute` scans the command string for self-terminating patterns and, on a match,
  **throws** (the runtime contract: tool failures are signaled by throwing — the executor converts the
  throw into an error tool result).
- A `tool_execution_start` observer emits a visible notice as a fallback if the wrapper ever misses.
- Disable flag: `--omo-senpi-self-kill-guard-disabled`

**Blocked patterns** (`detect.ts`, all derived from the incident log)

- `taskkill ... /IM node.exe|bun(.exe)` (both `/IM` and `//IM`)
- `taskkill ...` nested inside `cmd //c "..."` wrappers
- PID loops over node: `tasklist | grep node` → `taskkill //F //PID` (whole-command heuristic)
- `pkill`/`killall`/`tskill node`, `Stop-Process -Name node*`, `Get-Process node | Stop-Process`,
  `wmic ... node.exe ... delete`

**Still allowed:** `taskkill /F /PID <specific pid>` (no image-wide kill), dev-server starts, port checks.

**Files**

| File | Purpose |
|---|---|
| `packages/omo-senpi/src/components/self-kill-guard/detect.ts` | pure detector (patterns / segment splitter / reasons) |
| `packages/omo-senpi/src/components/self-kill-guard/component.ts` | tool execute wrapper + event observer |
| `packages/omo-senpi/src/components/self-kill-guard/*.test.ts` | 24 unit tests |
| `packages/omo-senpi/src/extension/index.ts` | component registration (2 lines) |
| `plugin/extensions/omo.js` | **generated bundle — must be regenerated before merge** (only source is committed) |

**Verification:** 24 new unit tests pass; package typecheck (`tsgo --noEmit`) passes; root monorepo
typecheck passes. Full package suite: 495 pass / 15 fail — the 15 are pre-existing failures from
unrelated dirty-worktree artifact drift (ultrawork generated directive, package-shape audit, QA
sandbox scripts), confirmed by stash comparison. `bun run build` and `bun run test:codex` were not run
locally because this worktree carries unrelated in-progress generated bundles that those commands
would overwrite; CI should run them, and the bundle regeneration is a merge requirement.

## 4. Recommended senpi-core follow-up (defense layer 2, separate issue)

The extension guard only applies where omo-senpi is installed. The root fix for all Senpi users lives
in the senpi core (`@code-yeongyu/senpi`). Two proposals:

1. **Guard inside the bash tool itself**
   At the entry of `src/core/extensions/builtin/terminal/tools/bash.ts`, refuse self-terminating
   patterns (the `detect.ts` detector can be ported as-is).
2. **Default deny in the permission system**
   In `src/core/extensions/builtin/permission-system/config.ts`, append default deny rules for the
   `taskkill`/`pkill`/`killall`/`tskill`/`Stop-Process` bash prefixes after the `full-access` preset.
   (Permission patterns are first-token based — `BashArity.prefix` returns `taskkill` for
   `taskkill /F /IM node.exe`, so a `bash: { "taskkill": "deny" }` rule matches.)

## 5. Immediate user mitigation (works before this PR ships)

Adding deny rules to `~/.senpi/agent/settings.json` blocks the same incident today (permission
evaluation gives later rules precedence over the default preset):

```jsonc
{
  "permission": {
    "bash": {
      "taskkill": "deny",
      "tskill": "deny",
      "pkill": "deny",
      "killall": "deny",
      "Stop-Process": "deny"
    },
    "bash_input": {
      "taskkill": "deny",
      "tskill": "deny",
      "pkill": "deny",
      "killall": "deny",
      "Stop-Process": "deny"
    }
  }
}
```

Note: this also blocks targeted `taskkill /PID <pid>` (patterns are first-token based). For a
targeted kill, run it yourself or temporarily remove the rule. Once this PR ships, targeted kills stay
allowed while image-wide kills are blocked.

**Known limitation:** the permission system matches on the command's first token only
(`BashArity.prefix`), so the settings rules do NOT cover `cmd //c "taskkill /F /IM node.exe /T"`
(first token `cmd`) or `for pid in $(tasklist ...); do taskkill //F //PID ...; done` (first token
`for`) — the two shapes that actually killed the host in the incident. The code guard in this PR
detects those shapes regardless of position; until it ships, the new-session safety rules in section 6
are the primary defense.

## 6. New-session safety guidance

Paste this as the first message of any new session:

```text
IMPORTANT safety rules — follow them strictly:
1. NEVER run "kill all node processes" commands: taskkill /F /IM node.exe (or //IM),
   taskkill PID loops over `tasklist | grep node`, cmd //c "taskkill /F /IM node.exe /T",
   pkill/killall/tskill node, Stop-Process -Name node* are forbidden. The senpi/omo system
   itself runs as node.exe, so these commands kill the session you are running in.
2. To stop a dev server: use kill_bash({ bash_id }) for bash sessions, or find the exact
   port owner with `netstat -ano | findstr :5173` and kill only that PID with
   `taskkill /PID <pid> /F`.
3. Do not leave background dev servers running; use bounded start-verify-stop patterns
   (e.g. Playwright managed webServer).
4. If a session dies, start a new session and re-state these rules.
```

## 7. Issue / PR handoff summary

- **Issue title (proposal):** `[Windows] Agent can kill the senpi host itself via blanket taskkill, terminating the session`
- **Body:** copy sections 1–2 (incident + root cause + evidence table).
- **PR title (proposal):** `fix(senpi): block self-terminating shell commands in bash/bash_input/monitor`
- **PR body:** copy section 3 (changes + verification) and section 4 (core follow-up). Note the
  `plugin/extensions/omo.js` bundle regeneration requirement.
