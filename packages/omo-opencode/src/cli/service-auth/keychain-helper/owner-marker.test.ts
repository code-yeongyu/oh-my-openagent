import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHarness, type Harness, isDarwin, userSearchList } from "../../../../../omo-native/test/keychain-helper.test-support"
import { probeOwnerMarker } from "./owner-marker"

const OWNED = "e".repeat(64)
const FOREIGN = "f".repeat(64)

describe.skipIf(!isDarwin)("owner-marker probe without the helper (#11262 addendum row 9b)", () => {
  let harness: Harness
  let searchListBefore = ""

  beforeAll(async () => {
    searchListBefore = await userSearchList()
    harness = await createHarness()
  })

  afterAll(async () => {
    await harness.dispose()
    expect(await userSearchList()).toBe(searchListBefore)
  })

  test("#given a helper-owned item, a foreign item and no item #when probed by attributes only #then each is told apart and no secret is read", async () => {
    expect((await harness.run({ v: 1, verb: "write", account: OWNED, value: "dummy-owned" })).reply).toEqual({ ok: true, created: true })
    expect(await harness.fixture("add", FOREIGN, "dummy-foreign")).toContain("status 0")

    expect(await probeOwnerMarker("omo-cli", OWNED, harness.keychain)).toBe("helper-owned")
    expect(await probeOwnerMarker("omo-cli", FOREIGN, harness.keychain)).toBe("other")
    expect(await probeOwnerMarker("omo-cli", "0".repeat(64), harness.keychain)).toBe("absent")

    expect((await harness.run({ v: 1, verb: "remove", account: OWNED })).reply).toEqual({ ok: true })
    expect(await harness.fixture("delete", FOREIGN)).toContain("status 0")
  })
})
