import { describe, expect, test } from "bun:test"

import { OMO_NATIVE_PROPERTY_ALLOWLISTS } from "../../packages/omo-senpi/src/components/telemetry/product-identity"
import { assertAllowlistCoverage } from "./omo-native-telemetry-qa.mjs"

const EXPECTED_EVENTS = [
  "daily_active",
  "delegation_started",
  "feature_used",
  "prompt_submitted",
  "session_started",
  "skill_loaded",
  "turn_completed",
] as const

describe("OmO Native telemetry QA allowlist source", () => {
  test("#given the shared product allowlist #when QA initializes #then it covers exactly the seven native events", () => {
    expect(() => assertAllowlistCoverage(OMO_NATIVE_PROPERTY_ALLOWLISTS)).not.toThrow()
    expect(Object.keys(OMO_NATIVE_PROPERTY_ALLOWLISTS).sort()).toEqual(EXPECTED_EVENTS)
  })

  test("#given a missing or extra event #when QA validates coverage #then divergence fails loudly", () => {
    const { daily_active: _removed, ...missing } = OMO_NATIVE_PROPERTY_ALLOWLISTS
    expect(() => assertAllowlistCoverage(missing)).toThrow("missing=daily_active")
    expect(() => assertAllowlistCoverage({ ...OMO_NATIVE_PROPERTY_ALLOWLISTS, bogus_event: [] })).toThrow("extra=bogus_event")
  })
})
