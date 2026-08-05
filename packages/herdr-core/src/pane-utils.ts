import type { HerdrCommandResult } from "./runner"

export type HerdrPaneId = string // e.g. "w1:p2" or "wJ:p1" (workspace ids are alphanumeric)

const HERDR_PANE_ID_PATTERN = /^w[a-zA-Z0-9]+:p[0-9]+$/

export function isHerdrPaneId(value: string): boolean {
  return HERDR_PANE_ID_PATTERN.test(value)
}

/** Extract the workspace id (e.g. "w1" or "wJ") from a pane id (e.g. "w1:p2"). */
export function getWorkspaceIdFromPaneId(paneId: string): string | undefined {
  const match = /^(w[a-zA-Z0-9]+):/.exec(paneId)
  return match?.[1]
}

/** Parse the first pane id found in a command's stdout (herdr pane split prints the new pane id). */
export function parsePaneIdFromOutput(output: string): string | undefined {
  const match = /\bw[a-zA-Z0-9]+:p[0-9]+\b/.exec(output)
  return match?.[0]
}

export function buildSplitArgs(options: {
  callerPaneId: string
  direction: "right" | "down"
  ratio?: number
  cwd?: string
}): Array<string> {
  const args = ["pane", "split", options.callerPaneId, "--direction", options.direction]
  if (options.ratio !== undefined) {
    args.push("--ratio", String(options.ratio))
  }
  if (options.cwd) {
    args.push("--cwd", options.cwd)
  }
  return args
}

export function buildRenameArgs(paneId: string, label: string): Array<string> {
  return ["pane", "rename", paneId, label]
}

export function buildRunArgs(paneId: string, command: string): Array<string> {
  return ["pane", "run", paneId, command]
}

export function buildCloseArgs(paneId: string): Array<string> {
  return ["pane", "close", paneId]
}

export function buildListPanesArgs(workspaceId?: string): Array<string> {
  const args = ["pane", "list"]
  if (workspaceId) {
    args.push("--workspace", workspaceId)
  }
  return args
}

export type ListPanesResult = {
  success: boolean
  paneIds: Array<string>
  output: string
}

function parseJsonPaneIds(output: string): Array<string> | undefined {
  try {
    const data = JSON.parse(output)
    const panes = data?.result?.panes
    if (!Array.isArray(panes)) return undefined
    const ids = panes
      .map((pane: { pane_id?: unknown }) => (typeof pane?.pane_id === "string" ? pane.pane_id : undefined))
      .filter((id: string | undefined): id is string => Boolean(id))
    return ids
  } catch {
    return undefined
  }
}

export function parsePaneIdsFromListOutput(output: string): Array<string> {
  // herdr pane list returns a JSON object ({ result: { panes: [{ pane_id, ... }] } })
  const jsonPaneIds = parseJsonPaneIds(output)
  if (jsonPaneIds) return jsonPaneIds
  // Fallback for plain line-per-pane output
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(isHerdrPaneId)
}

export function listPanesResult(result: HerdrCommandResult): ListPanesResult {
  return {
    success: result.success,
    output: result.output,
    paneIds: parsePaneIdsFromListOutput(result.output),
  }
}
