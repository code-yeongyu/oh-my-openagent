import { expect, test } from "bun:test"
import { createGatewayRulesPromptHandler } from "./prompt"

test("#given a throwing preview store #when gateway rules are previewed #then the prompt passes through and the lookup warns once", async () => {
  // given
  const warnings: string[] = []
  const failure = new Error("fixture database unavailable")
  const handler = createGatewayRulesPromptHandler({
    ensureStore: async () => { throw new Error("preview must not open the real store") },
    previewBlockForSession: async () => { throw failure },
    onLookupError: (message) => warnings.push(message),
  })
  const event = { type: "before_agent_start", systemPrompt: "BASE", preview: true }
  const ctx = { sessionManager: { getSessionId: () => "fixture" } }
  // when
  const results = [await handler(event, ctx), await handler(event, ctx)]
  // then
  expect(results).toEqual([undefined, undefined])
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toContain(failure.message)
})
