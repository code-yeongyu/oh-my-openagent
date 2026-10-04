import type { InternalSessionOp } from "../../thread/gateway/store-extensions"

const object = (properties: Record<string, unknown>, required: readonly string[] = []) =>
  ({ type: "object", additionalProperties: false, properties, required }) as const

/**
 * The gateway_rules ops a session reaches only from its own component: the store stamps the engine
 * caller (`caller_session_durable_id`), the public extensionCall refuses them (caller_not_allowed), and
 * none becomes a model tool. Each answers or writes for the CALLER only, never for a session named in args.
 */
export const GATEWAY_RULES_SESSION_OPS: readonly InternalSessionOp[] = [
  { op: "blockForSession", internal: true, parameters: object({}) },
  { op: "memberForSession", internal: true, parameters: object({}) },
  { op: "digestForSession", internal: true, parameters: object({}) },
  {
    op: "digestDelivered", internal: true,
    parameters: object({ scope: { type: "string", minLength: 1 }, version: { type: "integer" }, last_seq: { type: "integer", minimum: 0 } }, ["scope", "version", "last_seq"]),
  },
  {
    op: "learningCommitted", internal: true,
    parameters: object({
      text: { type: "string", minLength: 1, maxLength: 16_384 },
      cwd: { type: "string", minLength: 1 },
      memory_home: { type: "string", minLength: 1 },
      now: { type: "integer", minimum: 0 },
    }, ["text", "cwd", "memory_home", "now"]),
  },
]
