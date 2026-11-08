import type { DagRunId } from "@oh-my-opencode/senpi-task/dag"
import type { PausedDagGuideCommand } from "../../../../senpi-task/src/dag/paused-controls"
import { GuidanceError } from "../../../../senpi-task/src/pause/guidance"
import { failure, toolResult, type DagToolDeps, type DagToolResult } from "./dag-tool-contract"
import type { DagToolInput } from "./dag-tool-params"

export async function guideAction(deps: DagToolDeps, params: DagToolInput, runId: DagRunId): Promise<DagToolResult> {
  const snapshot = deps.manager.snapshot(runId, deps.parentSessionId())
  if (deps.guide === undefined) return failure("node_not_continuable", "Guidance is not available in this session.")
  let command: PausedDagGuideCommand
  if (params.guidance_id !== undefined) {
    if (params.remove === true) command = { kind: "remove", id: params.guidance_id }
    else if (params.text !== undefined && params.text.trim().length > 0) command = { kind: "edit", id: params.guidance_id, text: params.text }
    else return failure("invalid_arguments", "Editing guidance requires text or remove=true.")
  } else {
    if (params.text === undefined || params.text.trim().length === 0 || params.remove === true) {
      return failure("invalid_arguments", "New guidance requires text.")
    }
    const node = params.node_id === undefined ? undefined : snapshot.nodes.find(node => node.id === params.node_id)
    if (params.node_id !== undefined && node === undefined) return failure("node_not_found", "Guidance target does not exist.")
    command = { kind: "add", text: params.text, ...(node === undefined ? {} : { nodeId: node.id }) }
  }
  try {
    const guidance = await deps.guide(runId, command)
    return toolResult(`Stored guidance ${guidance.id} (${guidance.state}).`, { kind: "guided", run_id: runId, guidance })
  } catch (error) {
    if (error instanceof GuidanceError) {
      switch (error.code) {
        case "frozen": return failure("guidance_frozen", "Dispatched guidance cannot be changed.")
        case "not_found": return failure("guidance_not_found", "Guidance does not exist.")
        case "duplicate_id": throw error
        default: throw new Error(`Unexpected guidance error: ${error.code satisfies never}`)
      }
    }
    throw error
  }
}
