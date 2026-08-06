import * as z from "zod"

const OmoTeamMemberBaseSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9-]+$/),
  cwd: z.string().optional(),
  worktreePath: z.string().optional(),
  subscriptions: z.array(z.string()).optional(),
  backendType: z.enum(["in-process", "tmux"]).default("in-process"),
  color: z.string().optional(),
  isActive: z.boolean().default(true),
}).strict()

export const OmoTeamCategoryMemberSchema = OmoTeamMemberBaseSchema.extend({
  kind: z.literal("category"),
  category: z.string().min(1),
  prompt: z.string().min(1),
})

export const OmoTeamSubagentMemberSchema = OmoTeamMemberBaseSchema.extend({
  kind: z.literal("subagent_type"),
  subagent_type: z.string().min(1),
  prompt: z.string().optional(),
})

export const OmoTeamMemberSchema = z.discriminatedUnion("kind", [
  OmoTeamCategoryMemberSchema,
  OmoTeamSubagentMemberSchema,
])

const OmoTeamSpecBaseSchema = z.object({
  version: z.literal(1).default(1),
  name: z.string().min(1).regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().optional(),
  createdAt: z.number().int().positive().optional(),
  leadAgentId: z.string().optional(),
  teamAllowedPaths: z.array(z.string()).optional(),
  sessionPermission: z.string().optional(),
  members: z.array(OmoTeamMemberSchema).min(1).max(8),
}).strict()

export const OmoTeamSpecSchema = OmoTeamSpecBaseSchema.superRefine((teamSpec, ctx) => {
  if (teamSpec.leadAgentId === undefined && teamSpec.members.length > 1) {
    ctx.addIssue({
      code: "custom",
      message: "leadAgentId required when a team has multiple members",
      path: ["leadAgentId"],
    })
  }
})

export const OmoTeamSpecLayerSchema = OmoTeamSpecBaseSchema.partial()

export const OmoTeamsConfigSchema = z.record(z.string(), OmoTeamSpecSchema)
export const OmoTeamsConfigLayerSchema = z.record(z.string(), OmoTeamSpecLayerSchema)

export type OmoTeamMember = z.infer<typeof OmoTeamMemberSchema>
export type OmoTeamSpec = z.infer<typeof OmoTeamSpecSchema>
export type OmoTeamsConfig = z.infer<typeof OmoTeamsConfigSchema>
