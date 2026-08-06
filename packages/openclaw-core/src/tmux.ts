import { runTmuxCommand, type TmuxCommandResult } from "@oh-my-opencode/tmux-core"
import { getTmuxPath } from "./tmux-path"

type OpenClawTmuxDeps = {
  readonly getTmuxPath: () => Promise<string | null>
  readonly runTmuxCommand: (tmuxPath: string, args: string[]) => Promise<TmuxCommandResult>
}

const defaultTmuxDeps: OpenClawTmuxDeps = {
  getTmuxPath,
  runTmuxCommand,
}

async function runOpenClawTmuxCommand(args: string[], deps: OpenClawTmuxDeps) {
  const tmuxPath = await deps.getTmuxPath()
  if (!tmuxPath) {
    return null
  }

  return deps.runTmuxCommand(tmuxPath, args)
}

export function getCurrentTmuxSession(): string | null {
  const env = process.env.TMUX
  if (!env) return null
  const match = env.match(/(\d+)$/)
  return match ? `session-${match[1]}` : null
}

export async function getTmuxSessionName(): Promise<string | null> {
  return getTmuxSessionNameWithDeps(defaultTmuxDeps)
}

export async function getTmuxSessionNameWithDeps(deps: OpenClawTmuxDeps): Promise<string | null> {
  try {
    const result = await runOpenClawTmuxCommand(["display-message", "-p", "#S"], deps)
    if (!result?.success) return null
    return result.output.trim() || null
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return null
  }
}

export async function captureTmuxPane(paneId: string, lines = 15): Promise<string | null> {
  return captureTmuxPaneWithDeps(paneId, lines, defaultTmuxDeps)
}

export async function captureTmuxPaneWithDeps(
  paneId: string,
  lines: number,
  deps: OpenClawTmuxDeps,
): Promise<string | null> {
  try {
    const result = await runOpenClawTmuxCommand(["capture-pane", "-p", "-t", paneId, "-S", `-${lines}`], deps)
    if (!result?.success) return null
    return result.output.trim() || null
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return null
  }
}

export async function sendToPane(paneId: string, text: string, confirm = true): Promise<boolean> {
  return sendToPaneWithDeps(paneId, text, confirm, defaultTmuxDeps)
}

export async function sendToPaneWithDeps(
  paneId: string,
  text: string,
  confirm: boolean,
  deps: OpenClawTmuxDeps,
): Promise<boolean> {
  try {
    const literalResult = await runOpenClawTmuxCommand(["send-keys", "-t", paneId, "-l", "--", text], deps)
    if (!literalResult?.success) return false

    if (!confirm) return true

    const enterResult = await runOpenClawTmuxCommand(["send-keys", "-t", paneId, "Enter"], deps)
    return enterResult?.success ?? false
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return false
  }
}

export async function isTmuxAvailable(): Promise<boolean> {
  return isTmuxAvailableWithDeps(defaultTmuxDeps)
}

export async function isTmuxAvailableWithDeps(deps: OpenClawTmuxDeps): Promise<boolean> {
  try {
    const result = await runOpenClawTmuxCommand(["-V"], deps)
    return result?.success ?? false
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return false
  }
}

export function analyzePaneContent(content: string | null): { confidence: number } {
  if (!content) return { confidence: 0 }

  let confidence = 0
  if (content.includes("opencode")) confidence += 0.3
  if (content.includes("Ask anything...")) confidence += 0.5
  if (content.includes("Run /help")) confidence += 0.2

  return { confidence: Math.min(1, confidence) }
}
