import { spawn } from "../../../shared/tmux/tmux-utils/spawn-process"
import { log } from "../../../shared"
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"

type TeamLayoutMember = { name: string; sessionId: string; color?: string }

type TeamLayoutResult = {
  focusWindowId: string
  gridWindowId: string
  panesByMember: Record<string, string>
}

export function canVisualize(): boolean {
  return process.env.TMUX !== undefined
}

async function runTmux(tmuxPath: string, args: Array<string>): Promise<{ success: boolean; output: string }> {
  const proc = spawn([tmuxPath, ...args], { stdout: "pipe", stderr: "pipe" })
  const outputPromise = new Response(proc.stdout).text()
  const exitCode = await proc.exited
  const output = await outputPromise

  if (exitCode !== 0) {
    return { success: false, output: output.trim() }
  }

  return { success: true, output: output.trim() }
}

async function createWindow(
  tmuxPath: string,
  sessionName: string,
  windowName: string,
  layout: "main-vertical" | "tiled",
  members: Array<TeamLayoutMember>,
): Promise<{ windowId: string; panesByMember: Record<string, string> } | null> {
  const base = await runTmux(tmuxPath, ["new-window", "-d", "-P", "-F", "#{window_id}", "-t", sessionName, "-n", windowName])
  if (!base.success || !base.output) return null

  const panesByMember: Record<string, string> = {}
  const [lead, ...rest] = members
  if (!lead) return null

  const leadPane = await runTmux(tmuxPath, ["list-panes", "-t", `${sessionName}:${base.output}`, "-F", "#{pane_id}"])
  if (!leadPane.success || !leadPane.output) return null
  panesByMember[lead.name] = leadPane.output.split("\n")[0] ?? ""

  for (const member of rest) {
    const split = await runTmux(tmuxPath, ["split-window", "-d", "-P", "-F", "#{pane_id}", "-t", panesByMember[lead.name] ?? base.output, "sh", "-c", "cat >/dev/null"])
    if (!split.success || !split.output) return null
    panesByMember[member.name] = split.output
  }

  const layoutResult = await runTmux(tmuxPath, ["select-layout", "-t", `${sessionName}:${base.output}`, layout])
  if (!layoutResult.success) return null

  for (const member of members) {
    const paneId = panesByMember[member.name]
    if (!paneId) return null
    const label = member.color ? `${member.name} ${member.color}` : member.name
    const titleResult = await runTmux(tmuxPath, ["select-pane", "-t", paneId, "-T", label])
    if (!titleResult.success) return null
    await runTmux(tmuxPath, ["set-option", "-t", paneId, "pane-border-status", "top"])
    await runTmux(tmuxPath, ["set-option", "-t", paneId, "pane-border-format", `#{pane_title} ${label}`])
    await runTmux(tmuxPath, ["pipe-pane", "-I", "-t", paneId, "cat >/dev/null"])
  }

  return { windowId: base.output, panesByMember }
}

export async function createTeamLayout(
  teamRunId: string,
  members: Array<TeamLayoutMember>,
  tmuxMgr: TmuxSessionManager,
): Promise<TeamLayoutResult | null> {
  if (!canVisualize()) {
    log("tmux visualization unavailable, skipping")
    return null
  }

  try {
    void tmuxMgr
    const tmuxPath = await getTmuxPath()
    if (!tmuxPath) {
      log("tmux visualization unavailable, skipping")
      return null
    }

    const sessionName = `omo-team-${teamRunId}`
    const created = await runTmux(tmuxPath, ["new-session", "-d", "-s", sessionName, "-P", "-F", "#{window_id}"])
    if (!created.success || !created.output) return null

    const focus = await createWindow(tmuxPath, sessionName, "focus", "main-vertical", members)
    const grid = await createWindow(tmuxPath, sessionName, "grid", "tiled", members)
    if (!focus || !grid) return null

    return {
      focusWindowId: focus.windowId,
      gridWindowId: grid.windowId,
      panesByMember: focus.panesByMember,
    }
  } catch (error) {
    log("tmux visualization unavailable, skipping", { error: String(error) })
    return null
  }
}

export async function removeTeamLayout(teamRunId: string, tmuxMgr: TmuxSessionManager): Promise<void> {
  void tmuxMgr
  if (!canVisualize()) return

  try {
    const tmuxPath = await getTmuxPath()
    if (!tmuxPath) return
    await runTmux(tmuxPath, ["kill-session", "-t", `omo-team-${teamRunId}`])
  } catch {
    return
  }
}
