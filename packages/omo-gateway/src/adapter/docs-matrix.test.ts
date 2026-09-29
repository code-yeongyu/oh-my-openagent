import { expect, test } from "bun:test"
import { FAKE_DEFAULT_CAPABILITIES } from "../adapters/fake/adapter"
import { documentedCapabilities, readPlatformMatrix } from "./docs-matrix"

test("the platform matrix has one column per Capabilities flag, in the contract's order", () => {
  expect(readPlatformMatrix().columns).toEqual(Object.keys(FAKE_DEFAULT_CAPABILITIES))
})

test("the Fake row of the platform matrix equals FakeAdapter's default Capabilities", () => {
  expect(documentedCapabilities("Fake (`FakeAdapter` defaults)")).toEqual({ ...FAKE_DEFAULT_CAPABILITIES })
})
