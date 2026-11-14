// L2 of the row 55 review: --scenario and --all apply the same admission checks to every
// scenario file - exactly one registered scenario, named as its file, with an admission.
import { describe, expect, test } from "bun:test"

import { refusal, type Scenario } from "./scenario.ts"

function scenario(name: string, admit: string): Scenario {
  return {
    name,
    admit: admit as Scenario["admit"],
    precondition: async () => undefined,
    run: async () => ({ pass: true, facts: {}, receipts: [] }),
  }
}

describe("scenario admission", () => {
  test("one scenario named as its file with an admission is admitted", () => {
    for (const admit of ["os", "host-relay", "none"]) {
      expect(refusal("capture-marker-pixels", [scenario("capture-marker-pixels", admit)])).toBeUndefined()
    }
  })

  test("a file that registers no scenario is refused", () => {
    expect(refusal("helper", [])).toBe("helper registers no scenario")
  })

  test("under --all a helper file that registers nothing is skipped, not refused", () => {
    expect(refusal("engine", [], { helpersAllowed: true })).toBeUndefined()
    expect(refusal("a", [scenario("b", "none")], { helpersAllowed: true })).toBe("a registered the scenario b")
  })

  test("a file that registers two scenarios is refused", () => {
    expect(refusal("a", [scenario("a", "none"), scenario("b", "none")])).toBe("a registers 2 scenarios")
  })

  test("a scenario named other than its file is refused", () => {
    expect(refusal("a", [scenario("b", "none")])).toBe("a registered the scenario b")
  })

  test("a scenario with no admission is refused", () => {
    expect(refusal("a", [scenario("a", "sometimes")])).toBe("a declares no admission (os, host-relay or none)")
  })
})
