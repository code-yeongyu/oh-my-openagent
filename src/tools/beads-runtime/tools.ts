import { tool, type ToolDefinition } from "@opencode-ai/plugin"

import type { BeadsRuntimeFeature } from "../../features/beads-runtime"
import {
  attachBeadToContinuation,
  getBeadsRuntimeStatusSnapshot,
} from "../../features/beads-runtime"
import type { BeadsRuntimeAttachArgs } from "./types"

type ToolContextWithSession = {
  sessionID: string
}

function formatAttachResult(result: Awaited<ReturnType<typeof attachBeadToContinuation>>): string {
  const lines = [
    `Attached bead ${result.beadID} to the active continuation.`,
    `Source command: ${result.sourceCommand}`,
    `Worktree path: ${result.worktreePath}`,
  ]

  if (result.branchName) {
    lines.push(`Branch: ${result.branchName}`)
  }
  if (result.worktreeName) {
    lines.push(`Worktree: ${result.worktreeName}`)
  }

  return lines.join("\n")
}

export function createBeadsRuntimeTools(args: {
  beadsRuntime: BeadsRuntimeFeature
  directory: string
}): Record<string, ToolDefinition> {
  return {
    beads_runtime_attach: tool({
      description: "Attach active continuation to an explicitly selected bead.",
      args: {
        bead_id: tool.schema.string().describe("Explicit bead ID selected by /start or /resume"),
        source_command: tool.schema.enum(["start", "resume"]).describe("The OCK command that initiated the attach"),
        worktree_path: tool.schema.string().optional().describe("Resolved worktree path or project root"),
        branch_name: tool.schema.string().optional().describe("Current branch name when available"),
        worktree_name: tool.schema.string().optional().describe("Current worktree name when available"),
      },
      async execute(input: BeadsRuntimeAttachArgs, toolContext) {
        const ctx = toolContext as ToolContextWithSession
        const result = await attachBeadToContinuation({
          directory: args.directory,
          sessionID: ctx.sessionID,
          input: {
            beadID: input.bead_id,
            sourceCommand: input.source_command,
            worktreePath: input.worktree_path,
            branchName: input.branch_name,
            worktreeName: input.worktree_name,
          },
        })
        return formatAttachResult(result)
      },
    }),
    beads_runtime_status: tool({
      description: "Show bead attachment state for the active continuation.",
      args: {},
      async execute(_args, toolContext) {
        const ctx = toolContext as ToolContextWithSession
        const status = getBeadsRuntimeStatusSnapshot({
          directory: args.directory,
          sessionID: ctx.sessionID,
        })

        if (!status.activeContinuation || !status.beadID) {
          return "No active bead attachment is recorded for this continuation."
        }

        const lines = [
          `Bead ID: ${status.beadID}`,
          `Source command: ${status.sourceCommand ?? "unknown"}`,
          `Worktree path: ${status.worktreePath ?? args.directory}`,
          `Policy: ${args.beadsRuntime.statusPolicy.summary}`,
        ]
        if (status.branchName) {
          lines.push(`Branch: ${status.branchName}`)
        }
        if (status.worktreeName) {
          lines.push(`Worktree: ${status.worktreeName}`)
        }

        return lines.join("\n")
      },
    }),
  }
}
