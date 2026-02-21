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
      "close (close issue), sync (sync to git), init (initialize beads), claim (claim issue), " +
      "block (mark blocked), reopen (reopen issue), dep_add (add dependency), dep_remove (remove dependency).",
    args: {
      command: tool.schema
        .enum(["ready", "create", "update", "close", "sync", "init", "claim", "block", "reopen", "dep_add", "dep_remove"])
        .describe("The beads command to execute"),
      issue_id: tool.schema.string().optional().describe("Issue ID for update/close/claim/block/reopen/dep commands"),
      dep_id: tool.schema.string().optional().describe("Dependency issue ID for dep_add/dep_remove commands"),
      dep_type: tool.schema
        .enum(["blocks", "parent-child", "waits-for", "related", "relates-to", "duplicates", "supersedes"])
        .optional()
        .describe("Dependency type for dep_add command"),
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
      switch (args.command) {
        case "ready": {
          const result = await wrapper.ready()
          return JSON.stringify(result, null, 2)
        }
        case "create": {
          if (!args.title) {
            return JSON.stringify({ success: false, error: "title is required for create" })
          }
          const result = await wrapper.create(args.title, {
            priority: args.priority,
            issue_type: args.issue_type,
            assignee: args.assignee,
          })
          return JSON.stringify(result, null, 2)
        }
        case "update": {
          if (!args.issue_id) {
            return JSON.stringify({ success: false, error: "issue_id is required for update" })
          }
          const result = await wrapper.update(args.issue_id, {
            status: args.status,
            priority: args.priority,
            assignee: args.assignee,
          })
          return JSON.stringify(result, null, 2)
        }
        case "close": {
          if (!args.issue_id) {
            return JSON.stringify({ success: false, error: "issue_id is required for close" })
          }
          const result = await wrapper.close(args.issue_id, {
            reason: args.reason,
          })
          return JSON.stringify(result, null, 2)
        }
        case "sync": {
          const result = await wrapper.sync()
          return JSON.stringify(result, null, 2)
        }
        case "init": {
          const result = await wrapper.init()
          return JSON.stringify(result, null, 2)
        }
        case "claim": {
          if (!args.issue_id) {
            return JSON.stringify({ success: false, error: "issue_id is required for claim" })
          }
          const result = await wrapper.claim(args.issue_id, args.assignee)
          return JSON.stringify(result, null, 2)
        }
        case "block": {
          if (!args.issue_id) {
            return JSON.stringify({ success: false, error: "issue_id is required for block" })
          }
          const result = await wrapper.block(args.issue_id)
          return JSON.stringify(result, null, 2)
        }
        case "reopen": {
          if (!args.issue_id) {
            return JSON.stringify({ success: false, error: "issue_id is required for reopen" })
          }
          const result = await wrapper.reopen(args.issue_id)
          return JSON.stringify(result, null, 2)
        }
        case "dep_add": {
          if (!args.issue_id) {
            return JSON.stringify({ success: false, error: "issue_id is required for dep_add" })
          }
          if (!args.dep_id) {
            return JSON.stringify({ success: false, error: "dep_id is required for dep_add" })
          }
          const result = await wrapper.depAdd(args.issue_id, args.dep_id, args.dep_type ?? "blocks")
          return JSON.stringify(result, null, 2)
        }
        case "dep_remove": {
          if (!args.issue_id) {
            return JSON.stringify({ success: false, error: "issue_id is required for dep_remove" })
          }
          if (!args.dep_id) {
            return JSON.stringify({ success: false, error: "dep_id is required for dep_remove" })
          }
          const result = await wrapper.depRemove(args.issue_id, args.dep_id)
          return JSON.stringify(result, null, 2)
        }
        default:
          return JSON.stringify({ success: false, error: `Unknown command: ${args.command}` })
      }
    },
  })

  return { beads }
}
