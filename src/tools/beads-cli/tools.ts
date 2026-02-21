import type { PluginInput } from "@opencode-ai/plugin"
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { BeadsConfig } from "../../config"
import { BeadsWrapper } from "./wrapper"

export interface BeadsToolOptions {
  config: BeadsConfig
  ctx: PluginInput
}

export function createBeadsTools(options: BeadsToolOptions): Record<string, ToolDefinition> {
  const wrapper = new BeadsWrapper({ config: options.config })

  const beads: ToolDefinition = tool({
    description:
      "Beads task management CLI wrapper. " +
      "Commands: ready (list ready issues), create (new issue), update (modify issue), " +
      "close (close issue), sync (sync to git), init (initialize beads), claim (claim issue).",
    args: {
      command: tool.schema
        .enum(["ready", "create", "update", "close", "sync", "init", "claim"])
        .describe("The beads command to execute"),
      issue_id: tool.schema.string().optional().describe("Issue ID for update/close/claim commands"),
      title: tool.schema.string().optional().describe("Title for create command"),
      priority: tool.schema.number().min(0).max(4).optional().describe("Priority level 0-4"),
      status: tool.schema
        .enum(["open", "in_progress", "blocked", "deferred", "closed", "pinned", "hooked"])
        .optional()
        .describe("Status for update command"),
      issue_type: tool.schema
        .enum(["bug", "feature", "task", "epic", "chore", "decision", "message"])
        .optional()
        .describe("Issue type for create command"),
      assignee: tool.schema.string().optional().describe("Assignee for claim/create/update"),
      reason: tool.schema.string().optional().describe("Reason for close command"),
    },
    execute: async (args) => {
      try {
        switch (args.command) {
          case "ready": {
            const issues = await wrapper.ready()
            return JSON.stringify({ success: true, issues }, null, 2)
          }
          case "create": {
            if (!args.title) {
              return JSON.stringify({ success: false, error: "title is required for create" })
            }
            const issue = await wrapper.create(args.title, {
              priority: args.priority,
              issue_type: args.issue_type,
              assignee: args.assignee,
            })
            return JSON.stringify({ success: true, issue }, null, 2)
          }
          case "update": {
            if (!args.issue_id) {
              return JSON.stringify({ success: false, error: "issue_id is required for update" })
            }
            const issue = await wrapper.update(args.issue_id, {
              status: args.status,
              priority: args.priority,
              assignee: args.assignee,
            })
            return JSON.stringify({ success: true, issue }, null, 2)
          }
          case "close": {
            if (!args.issue_id) {
              return JSON.stringify({ success: false, error: "issue_id is required for close" })
            }
            const issue = await wrapper.close(args.issue_id, {
              reason: args.reason,
            })
            return JSON.stringify({ success: true, issue }, null, 2)
          }
          case "sync": {
            const result = await wrapper.sync()
            return JSON.stringify({ success: result })
          }
          case "init": {
            const result = await wrapper.init()
            return JSON.stringify({ success: result })
          }
          case "claim": {
            if (!args.issue_id) {
              return JSON.stringify({ success: false, error: "issue_id is required for claim" })
            }
            const issue = await wrapper.claim(args.issue_id, args.assignee)
            return JSON.stringify({ success: true, issue }, null, 2)
          }
          default:
            return JSON.stringify({ success: false, error: `Unknown command: ${args.command}` })
        }
      } catch (e) {
        return JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) })
      }
    },
  })

  return { beads }
}
