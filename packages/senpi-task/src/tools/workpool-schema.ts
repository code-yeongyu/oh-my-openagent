import { Type } from "typebox"

const nonempty = Type.String({ minLength: 1, pattern: "\\S" })
// A JSON Schema's unconstrained value covers every JSON value. The execution boundary also
// rejects non-JSON JavaScript values (undefined, functions and non-finite numbers).
const json = Type.Unknown()
const agent = Type.Union([
  Type.Object({ category: nonempty, prompt: nonempty, model: Type.Optional(nonempty) }, { additionalProperties: false }),
  Type.Object({ subagent_type: nonempty, prompt: nonempty, model: Type.Optional(nonempty) }, { additionalProperties: false }),
])
const poolId = Type.String({ pattern: "^wp_[0-9a-f]{32}$" })
export const WorkpoolYieldParams = Type.Object({
  op: Type.Literal("yield"),
  results: Type.Array(Type.Union([
    Type.Object({ key: nonempty, data: json }, { additionalProperties: false }),
    Type.Object({ key: nonempty, error: Type.Object({ code: nonempty, message: nonempty }, { additionalProperties: false }) }, { additionalProperties: false }),
  ])),
}, { additionalProperties: false })
// Validate entries independently inside the worker capability so one malformed sibling cannot
// suppress other results. The envelope still grants only yield, never caller-supplied identity.
export const WorkpoolWorkerYieldParams = Type.Object({
  op: Type.Literal("yield"),
  results: Type.Array(Type.Unknown({ description: "Each entry is {key,data:JSON} or {key,error:{code,message}}. Invalid entries receive individual typed refusals." })),
}, { additionalProperties: false })
export const WorkpoolParams = Type.Union([
  Type.Object({ op: Type.Literal("create"), name: nonempty, agent, mode: Type.Optional(Type.Union([Type.Literal("fresh"), Type.Literal("keep_alive")])), tools: Type.Optional(Type.Array(nonempty)) }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal("push"), pool_id: poolId, items: Type.Array(Type.Object({ key: nonempty, input: json }, { additionalProperties: false })) }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal("close"), pool_id: poolId }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal("inspect"), pool_id: poolId }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal("cancel"), pool_id: poolId }, { additionalProperties: false }),
  WorkpoolYieldParams,
])
