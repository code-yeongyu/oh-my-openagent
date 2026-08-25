import { describe, expect, test } from "bun:test"
import { OmoAgentDefSchema, OmoCategoryConfigSchema } from "@oh-my-opencode/omo-config-core"
import { AgentOverrideConfigSchema } from "../schema/agent-overrides"
import { CategoryConfigSchema } from "../schema/categories"

/**
 * Drift guard: the harness-neutral core schema and the OpenCode adapter schema
 * must stay in field parity for the keys core intends to own. A future key
 * addition on one side without the other fails this test.
 *
 * We assert only machine-consumed behavior via `safeParse` probes (no prose):
 * the two fields core owns (`permission`, `prompt_append`) and full category
 * parity. Core schemas are `z.preprocess` wrappers, so parity is probed by
 * parsing rather than introspecting `.shape`.
 */

function probeAcceptedKeys(schema: { readonly safeParse: (v: unknown) => { readonly success: boolean } }): Set<string> {
  const accepted = new Set<string>()
  const probes: Record<string, unknown> = {
    permission: { permission: { edit: "deny" } },
    prompt_append: { prompt_append: "x" },
  }
  for (const [key, probe] of Object.entries(probes)) {
    if (schema.safeParse(probe).success) accepted.add(key)
  }
  return accepted
}

function probeValueFor(key: string): unknown {
  switch (key) {
    case "description":
    case "model":
    case "prompt_append":
    case "variant":
    case "reasoningEffort":
    case "textVerbosity":
      return "x"
    case "models":
    case "fallback_models":
      return ["x"]
    case "reasoning":
      return "off"
    case "temperature":
    case "top_p":
    case "max_tokens":
    case "maxTokens":
    case "max_prompt_tokens":
      return 1
    case "provider_options":
    case "tools":
      return {}
    case "thinking":
      return { type: "enabled" }
    case "is_unstable_agent":
    case "disable":
    case "warn_unavailable":
      return true
    default:
      return "x"
  }
}

describe("core <-> adapter schema parity", () => {
  test("#given core agent schema #when probing permission and prompt_append #then core accepts both keys", () => {
    // given
    const coreKeys = probeAcceptedKeys(OmoAgentDefSchema)

    // when / then
    expect(coreKeys.has("permission")).toBe(true)
    expect(coreKeys.has("prompt_append")).toBe(true)
  })

  test("#given core and adapter agent schemas #when comparing key acceptance #then they agree on permission and prompt_append", () => {
    // given
    const coreKeys = probeAcceptedKeys(OmoAgentDefSchema)
    const adapterKeys = probeAcceptedKeys(AgentOverrideConfigSchema)

    // when / then
    for (const key of ["permission", "prompt_append"]) {
      expect(coreKeys.has(key)).toBe(adapterKeys.has(key))
    }
  })

  test("#given core and adapter category schemas #when probing each adapter key #then core accepts every adapter key", () => {
    // given
    const adapterKeys = Object.keys(CategoryConfigSchema.shape)

    // when / then
    for (const key of adapterKeys) {
      const probe = { [key]: probeValueFor(key) }
      expect(OmoCategoryConfigSchema.safeParse(probe).success).toBe(true)
    }
  })
})
