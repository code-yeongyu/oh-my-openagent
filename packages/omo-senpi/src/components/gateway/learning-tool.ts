import { Type } from "typebox"
import { z } from "zod"

import type { SenpiExtensionAPI } from "../../extension/types"
import { gatewaySessionId, type GatewayScopeAccess } from "./scope-access"

const Input = z.strictObject({ text: z.string().trim().min(1).max(16_384) })

export function registerGatewayLearning(pi: SenpiExtensionAPI, access: GatewayScopeAccess): void {
  pi.registerTool({
    name: "gateway_learning",
    label: "Scope learning",
    description: "Save team working knowledge to your current gateway scope memory.",
    parameters: Type.Object({ text: Type.String({ minLength: 1, maxLength: 16_384 }) }, { additionalProperties: false }),
    executionMode: "sequential",
    execute: async (_id: string, args: unknown, _signal: unknown, _update: unknown, eventCtx: unknown) => {
      const parsed = Input.safeParse(args)
      if (!parsed.success) return result({ kind: "refused", reason: parsed.error.message })
      const session = gatewaySessionId(eventCtx)
      if (session === undefined) return result({ kind: "refused", reason: "gateway_learning requires an engine-stamped caller session" })
      const cwd = eventCtx !== null && typeof eventCtx === "object" && typeof Reflect.get(eventCtx, "cwd") === "string"
        ? String(Reflect.get(eventCtx, "cwd")) : pi.cwd ?? process.cwd()
      const committed = await access.callAs(session, "learningCommitted", {
        text: parsed.data.text,
        cwd,
        memory_home: access.memoryHome(cwd),
        now: Date.now(),
      })
      return result(committed)
    },
  })
}

function result(value: unknown) {
  const refused = value !== null && typeof value === "object" && Reflect.get(value, "kind") === "refused"
  return { content: [{ type: "text", text: JSON.stringify(value) }], details: value, ...(refused ? { isError: true } : {}) }
}
