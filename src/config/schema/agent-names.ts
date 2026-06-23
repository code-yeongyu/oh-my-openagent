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
  "sentinel",
  "sati",
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
  "dsl-textx-ecosystem",
  "dsl-pyecore-advanced",
  "dsl-model-transformation",
  "dsl-testing",
  "dsl-validation",
  "dsl-composition",
  "security-core",
  "security-secrets",
  "security-sast",
  "security-dast",
  "security-dependencies",
  "security-api",
  "security-crypto",
  "security-infra",
  "security-review",
  "tdd-enforcer",
  "review-work",
  "quality-gate",
  "software-dev",
  "matrixx-self-config",
])

export const AgentNameSchema = BuiltinAgentNameSchema
export type AgentName = z.infer<typeof AgentNameSchema>

export type BuiltinSkillName = z.infer<typeof BuiltinSkillNameSchema>
