import { z } from "zod"

export const BuiltinAgentNameSchema = z.enum([
  "morpheus",
  "keymaker",
  "oracle",
  "merovingian",
  "operator",
  "trinity",
  "construct",
  "seraph",
  "smith",
  "architect",
  "cipher",
])

export const BuiltinSkillNameSchema = z.enum([
  "playwright",
  "agent-browser",
  "dev-browser",
  "frontend-ui-ux",
  "git-master",
  "dsl-core",
  "dsl-grammar",
  "dsl-codegen",
  "dsl-metamodel",
  "dsl-tooling",
])

export const OverridableAgentNameSchema = z.enum([
  "build",
  "plan",
  "morpheus",
  "keymaker",
  "mouse",
  "OpenCode-Builder",
  "oracle",
  "seraph",
  "smith",
  "merovingian",
  "operator",
  "trinity",
  "construct",
  "architect",
  "cipher",
])

export const AgentNameSchema = BuiltinAgentNameSchema
export type AgentName = z.infer<typeof AgentNameSchema>

export type BuiltinSkillName = z.infer<typeof BuiltinSkillNameSchema>
