import { describe, expect, test } from "bun:test"
import { REQUEST_TYPES } from "../../src/local-api/validate.ts"
import { UNSERVED_REQUEST_TYPES } from "./conformance/fake-owner-handlers.ts"
import { fakeOwnerTarget, loadFixtures, runConformance } from "./conformance/runner.ts"

runConformance(fakeOwnerTarget)

describe("conformance fixtures", () => {
  test("every request type this owner serves and the hello have at least one ok case and one refusal", () => {
    const fixtures = loadFixtures()
    const served = REQUEST_TYPES.filter((type) => !UNSERVED_REQUEST_TYPES.includes(type))
    expect(UNSERVED_REQUEST_TYPES.filter((type) => !REQUEST_TYPES.some((known) => known === type))).toEqual([])
    const covered = [...served, "hello"].map((type) => {
      const cases = fixtures.filter((f) => f.request === type).flatMap((f) => f.cases)
      return {
        type,
        ok: cases.some((c) => c.outcome === "ok"),
        refusal: cases.some((c) => c.outcome === "refusal"),
      }
    })
    expect(covered.filter((c) => !c.ok || !c.refusal)).toEqual([])
    expect(fixtures.map((f) => f.request).toSorted()).toEqual([...served, "hello"].toSorted())
  })
})
