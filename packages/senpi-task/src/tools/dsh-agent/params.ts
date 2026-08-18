import { Type, type Static } from "typebox"

export const CallDshAgentParams = Type.Object({
  prompt: Type.String({ description: "Standalone task content for the dsh agent" }),
  cwd: Type.Optional(Type.String({ description: "Working directory for the dsh agent; defaults to the session directory" })),
  verify: Type.Optional(Type.String({ description: "Deterministic verification command to run after the agent finishes, e.g. 'bun test' or 'bun run typecheck'" })),
})
export type CallDshAgentParamsStatic = Static<typeof CallDshAgentParams>
