// Live-tail command builder for team-mode worker tmux panes.
//
// OpenCode TUI's `attach --session <child>` enters a static subagent-detail
// view (see binary string "session.child.promptDisabled") for any session
// that has a parentID. Team workers always carry parentID=lead — so the
// usual `opencode attach` lands in that read-only view and never streams
// live updates. This builder substitutes a small Python tailer that talks
// directly to the OpenCode HTTP API and renders message updates in plain
// text, side-stepping the TUI mode entirely.

import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { shellSingleQuote } from "../../../shared/shell-env"
// @ts-expect-error - bun text import
import liveTailScript from "../../../../script/team-pane-live-tail.py" with { type: "text" }

const SCRIPT_FILENAME = "omo-team-pane-live-tail.py"

let cachedPath: string | null = null

export function materializeLiveTailScript(): string {
  if (cachedPath !== null) return cachedPath
  const dir = join(tmpdir(), `omo-team-${process.pid}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, SCRIPT_FILENAME)
  writeFileSync(path, liveTailScript, { mode: 0o700 })
  cachedPath = path
  return path
}

export function buildLiveTailCommand(serverUrl: string, sessionId: string): string {
  const scriptPath = materializeLiveTailScript()
  return `python3 -u ${shellSingleQuote(scriptPath)} ${shellSingleQuote(serverUrl)} ${shellSingleQuote(sessionId)}`
}

export function _resetCacheForTests(): void {
  cachedPath = null
}
