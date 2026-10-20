import { describe, expect, test } from "bun:test"

import { OMO_NATIVE_EVENT_SCHEMAS } from "./event-schemas"
import { KNOWN_PROVIDERS, providerPropertyName } from "./model-vocabulary"
import { classifyProviders } from "./session-inventory"

describe("classifyProviders", () => {
  test("#given known and private provider ids #then known ids ship as sorted unique ids and private ones only as a count", () => {
    expect(classifyProviders(["openai", "my-gateway", "anthropic", "corp-proxy", "openai"])).toEqual({
      known: ["anthropic", "openai"],
      customCount: 2,
    })
  })

  test("#given no providers #then nothing is known and the count is zero", () => {
    expect(classifyProviders([])).toEqual({ known: [], customCount: 0 })
  })

  test("#given every built-in provider id #then each maps to a distinct boolean session_started property that the schema declares", () => {
    const schema: Readonly<Record<string, unknown>> = OMO_NATIVE_EVENT_SCHEMAS.session_started
    const names = KNOWN_PROVIDERS.map(providerPropertyName)
    expect(new Set(names).size).toBe(KNOWN_PROVIDERS.length)
    for (const name of names) {
      expect(name).toMatch(/^provider_[a-z][a-z0-9_]*$/)
      expect(schema[name]).toEqual({ type: "boolean" })
    }
  })
})
