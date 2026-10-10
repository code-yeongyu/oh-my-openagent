import { runTmuxCommand, type TmuxCommandResult } from "@oh-my-opencode/tmux-core"
import { log } from "../logger"
import { shellSingleQuote } from "../shell-quote"

export type MemberPaneSnapshot = {
  paneId: string
  attachServerUrl: string
  attachSessionId: string
  dead: boolean
  currentCommand: string
}

export type MemberPaneTarget = {
  name: string
  sessionId: string
  paneId: string
  worktreePath?: string
}

export type RefreshMemberPaneDeps = {
  runTmuxCommand: (tmuxPath: string, args: Array<string>, options?: { retry?: number; timeoutMs?: number }) => Promise<TmuxCommandResult>
  getTmuxPath: () => Promise<string | null | undefined>
  log: typeof log
}

const defaultDeps: RefreshMemberPaneDeps = {
  runTmuxCommand,
  getTmuxPath: async () => "tmux",
  log,
}

export type MemberPaneRefreshKind = "none" | "redraw" | "revive"

const REVIVE_SHELL_COMMANDS = new Set(["bash", "zsh", "sh", "fish", "ash", "dash", "ksh"])

function parsePaneSnapshot(paneId: string, output: string): MemberPaneSnapshot {
  const firstLine = (output.split("\n", 1)[0] ?? "").replace(/\r$/, "")
  const [attachServerUrl = "", attachSessionId = "", deadFlag = "", currentCommand = ""] = firstLine.split("\t")
  return {
    paneId,
    attachServerUrl,
    attachSessionId,
    dead: deadFlag === "1",
    currentCommand,
  }
}

export function decideMemberPaneRefresh(snapshot: MemberPaneSnapshot): MemberPaneRefreshKind {
  if (snapshot.attachServerUrl.length === 0 || snapshot.attachSessionId.length === 0) {
    return "none"
  }
  if (snapshot.dead || snapshot.currentCommand.length === 0 || REVIVE_SHELL_COMMANDS.has(snapshot.currentCommand)) {
    return "revive"
  }
  return "redraw"
}

export function buildAttachCommand(member: Pick<MemberPaneTarget, "sessionId" | "worktreePath">, serverUrl: string): string {
  const workingDirectory = member.worktreePath ?? process.cwd()
  return `opencode attach ${shellSingleQuote(serverUrl)} --session ${shellSingleQuote(member.sessionId)} --dir ${shellSingleQuote(workingDirectory)}`
}

export async function refreshMemberPane(member: MemberPaneTarget, deps: RefreshMemberPaneDeps = defaultDeps): Promise<MemberPaneRefreshKind> {
  try {
    const tmuxPath = await deps.getTmuxPath()
    if (!tmuxPath) return "none"

    const snapshotResult = await deps.runTmuxCommand(tmuxPath, [
      "display-message",
      "-p",
      "-t",
      member.paneId,
      "#{@omo_attach_server_url}\t#{@omo_attach_session_id}\t#{pane_dead}\t#{pane_current_command}",
    ])
    if (!snapshotResult.success) return "none"

    const snapshot = parsePaneSnapshot(member.paneId, snapshotResult.output)
    const kind = decideMemberPaneRefresh(snapshot)
    if (kind === "none") return "none"

    if (kind === "revive") {
      const command = buildAttachCommand(
        { sessionId: snapshot.attachSessionId, worktreePath: member.worktreePath },
        snapshot.attachServerUrl,
      )
      await deps.runTmuxCommand(tmuxPath, ["send-keys", "-t", member.paneId, command, "Enter"])
      deps.log("team member pane revived", { paneId: member.paneId, memberName: member.name, sessionId: member.sessionId })
      return "revive"
    }

    await deps.runTmuxCommand(tmuxPath, ["send-keys", "-t", member.paneId, "C-l"])
    return "redraw"
  } catch (error) {
    deps.log("team member pane refresh failed", {
      paneId: member.paneId,
      memberName: member.name,
      sessionId: member.sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
    return "none"
  }
}
