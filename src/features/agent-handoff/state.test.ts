/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"

import {
  recordAgentObservation,
  clearAgentObservation,
  _resetAllForTests,
} from "./state"

describe("recordAgentObservation", () => {
  beforeEach(() => {
    _resetAllForTests()
  })

  test("first observation in a session returns undefined", () => {
    const prior = recordAgentObservation("s1", "sisyphus")

    expect(prior).toBeUndefined()
  })

  test("same agent on consecutive observations returns undefined", () => {
    recordAgentObservation("s1", "sisyphus")
    const prior = recordAgentObservation("s1", "sisyphus")

    expect(prior).toBeUndefined()
  })

  test("changing agents returns the prior agent's display name", () => {
    recordAgentObservation("s1", "sisyphus")
    const prior = recordAgentObservation("s1", "hephaestus")

    expect(prior).toBe("sisyphus")
  })

  test("subsequent transitions return the most recent prior agent", () => {
    recordAgentObservation("s1", "sisyphus")
    recordAgentObservation("s1", "hephaestus")
    const prior = recordAgentObservation("s1", "atlas")

    expect(prior).toBe("hephaestus")
  })

  test("normalizes display variants so 'Hephaestus - Deep Agent' equals 'hephaestus'", () => {
    recordAgentObservation("s1", "hephaestus")
    const prior = recordAgentObservation("s1", "Hephaestus - Deep Agent")

    expect(prior).toBeUndefined()
  })

  test("observations are scoped per session", () => {
    recordAgentObservation("s1", "sisyphus")
    const prior = recordAgentObservation("s2", "hephaestus")

    expect(prior).toBeUndefined()
  })

  test("clearAgentObservation removes the stored value", () => {
    recordAgentObservation("s1", "sisyphus")
    clearAgentObservation("s1")
    const prior = recordAgentObservation("s1", "hephaestus")

    expect(prior).toBeUndefined()
  })
})
