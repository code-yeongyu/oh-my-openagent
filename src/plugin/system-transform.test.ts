import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { _resetForTesting, setSessionAgent } from "../features/claude-code-session-state"
import { createSystemTransformHandler } from "./system-transform"

const ULTRAWORK_PAYLOAD = "<ultrawork-mode> heavy ultrawork instructions"

describe("createSystemTransformHandler excluded_agents guard (#3735)", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  afterEach(() => {
    _resetForTesting()
  })

  test("skips ultrawork injection when current agent is in excluded_agents", async () => {
    // given
    setSessionAgent("s1", "cybersec")
    const handler = createSystemTransformHandler(
      { ultrawork: true },
      () => ULTRAWORK_PAYLOAD,
      ["cybersec"],
    )
    const output = { system: ["base system prompt"] }

    // when
    await handler({ sessionID: "s1", model: { id: "claude", providerID: "anthropic" } }, output)

    // then: system prompt is untouched
    expect(output.system).toEqual(["base system prompt"])
  })

  test("still injects ultrawork for non-excluded agents", async () => {
    // given
    setSessionAgent("s2", "sisyphus")
    const handler = createSystemTransformHandler(
      { ultrawork: true },
      () => ULTRAWORK_PAYLOAD,
      ["cybersec"],
    )
    const output = { system: ["base system prompt"] }

    // when
    await handler({ sessionID: "s2", model: { id: "claude", providerID: "anthropic" } }, output)

    // then: sisyphus still gets the ultrawork tag
    expect(output.system).toEqual(["base system prompt", ULTRAWORK_PAYLOAD])
  })

  test("matches excluded names case-insensitively", async () => {
    // given: session agent is "CyberSec" (mixed case), config has "cybersec"
    setSessionAgent("s3", "CyberSec")
    const handler = createSystemTransformHandler(
      { ultrawork: true },
      () => ULTRAWORK_PAYLOAD,
      ["cybersec"],
    )
    const output = { system: ["base"] }

    // when
    await handler({ sessionID: "s3", model: { id: "claude", providerID: "anthropic" } }, output)

    // then
    expect(output.system).toEqual(["base"])
  })

  test("injects normally when excluded_agents is undefined (backwards compatibility)", async () => {
    // given
    setSessionAgent("s4", "cybersec")
    const handler = createSystemTransformHandler(
      { ultrawork: true },
      () => ULTRAWORK_PAYLOAD,
    )
    const output = { system: ["base"] }

    // when
    await handler({ sessionID: "s4", model: { id: "claude", providerID: "anthropic" } }, output)

    // then: no excluded list means everyone gets the tag
    expect(output.system).toEqual(["base", ULTRAWORK_PAYLOAD])
  })

  test("does not block when session agent is unknown (no setSessionAgent)", async () => {
    // given: no session agent set for s5
    const handler = createSystemTransformHandler(
      { ultrawork: true },
      () => ULTRAWORK_PAYLOAD,
      ["cybersec"],
    )
    const output = { system: ["base"] }

    // when
    await handler({ sessionID: "s5", model: { id: "claude", providerID: "anthropic" } }, output)

    // then: with no known agent, we can't tell — default behavior wins (inject)
    expect(output.system).toEqual(["base", ULTRAWORK_PAYLOAD])
  })
})
