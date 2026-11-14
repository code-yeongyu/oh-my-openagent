import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { ZodError } from "zod"
import type { MissionStore } from "../../features/security-mission"
import { CreateMissionInputSchema } from "../../features/security-mission/types"

export function createSecurityMissionStartTool(
  store: MissionStore,
): ToolDefinition {
  return tool({
    description: `Start a new security mission with a defined scope.

Creates a mission with an objective and scope (allowed hosts/paths).
Returns the mission ID, name, and status.

Use this before adding findings. The scope defines what targets are authorized
for this security audit. Findings reference the mission by ID.`,
    args: {
      name: tool.schema.string().describe("Mission name"),
      objective: tool.schema.string().describe("Mission objective in plain language"),
      allowed_hosts: tool.schema
        .array(
          tool.schema.object({
            host: tool.schema.string(),
            label: tool.schema.string().optional(),
          }),
        )
        .optional()
        .describe("Authorized target hosts for this mission"),
      allowed_paths: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Authorized file paths for this mission"),
      allow_loopback: tool.schema
        .boolean()
        .optional()
        .describe("Allow loopback hosts (default: false)"),
      allow_private: tool.schema
        .boolean()
        .optional()
        .describe("Allow private network hosts (default: false)"),
    },
    execute: async (args) => {
      try {
        const input = CreateMissionInputSchema.parse({
          name: args.name,
          objective: args.objective,
          scope: {
            allowed_hosts: args.allowed_hosts,
            allowed_paths: args.allowed_paths,
            allow_loopback: args.allow_loopback,
            allow_private: args.allow_private,
          },
        })
        const mission = store.createMission(input)
        return JSON.stringify({
          mission: {
            id: mission.id,
            name: mission.name,
            status: mission.status,
          },
        })
      } catch (error) {
        if (error instanceof ZodError) {
          return JSON.stringify({ error: "validation_error", message: error.message })
        }
        return JSON.stringify({
          error: "internal_error",
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
  })
}
