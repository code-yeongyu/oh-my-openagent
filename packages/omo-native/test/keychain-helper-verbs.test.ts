import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { ACCOUNT, createHarness, NATIVE_BUILD_BUDGET_MS, type Harness, isDarwin, userSearchList } from "./keychain-helper.test-support"

const STAGING = `${ACCOUNT}.staging`
const OLD = `${ACCOUNT}.old`
const request = (verb: string, extra: Record<string, string> = {}) => ({ v: 1, verb, account: ACCOUNT, ...extra })

describe.skipIf(!isDarwin)("omo-keychain helper verbs on a throwaway keychain (#11262 design 2)", () => {
  let harness: Harness
  let searchListBefore = ""

  beforeAll(async () => {
    searchListBefore = await userSearchList()
    harness = await createHarness()
  }, NATIVE_BUILD_BUDGET_MS)

  afterAll(async () => {
    const keychain = harness.keychain
    await harness.dispose()
    expect(existsSync(keychain)).toBe(false)
    expect(await userSearchList()).toBe(searchListBefore)
  }, NATIVE_BUILD_BUDGET_MS)

  test("write creates an item only the helper may decrypt, with the omo-owner/1 marker", async () => {
    const value = JSON.stringify({ refreshToken: "dummy-token", note: "quote\" newline\n é 😀" })
    const created = await harness.run(request("write", { value }))
    expect(created.reply).toEqual({ ok: true, created: true })
    expect(created.exitCode).toBe(0)

    const read = await harness.run(request("read"))
    expect(read.reply).toMatchObject({ owned: true, value, marker: true, present: { staging: false, old: false } })
    expect(typeof read.reply?.cdat).toBe("number")
    expect(typeof read.reply?.mdat).toBe("number")

    expect(await harness.fixture("decrypt-apps", ACCOUNT)).toContain("decrypt-apps 1")
    expect(await harness.fixture("read", ACCOUNT)).toContain("status -25293")

    const updated = await harness.run(request("write", { value: "dummy-second" }))
    expect(updated.reply).toEqual({ ok: true })
    expect((await harness.run(request("read"))).reply).toMatchObject({ owned: true, value: "dummy-second" })
  })

  test("stage, retire and promote move the login by rename and keep owner access and marker", async () => {
    expect((await harness.run(request("stage", { value: "dummy-staged" }))).reply).toEqual({ ok: true, created: true })
    expect((await harness.run(request("stage", { value: "dummy-staged-2" }))).reply).toEqual({ ok: true })
    expect((await harness.run(request("read"))).reply).toMatchObject({ present: { staging: true, old: false } })

    expect((await harness.run(request("retire"))).reply).toEqual({ ok: true })
    const midway = await harness.run(request("read"))
    expect(midway.reply).toMatchObject({ owned: true, value: "dummy-staged-2", recover: true, present: { staging: true, old: true } })

    expect((await harness.run(request("promote"))).reply).toEqual({ ok: true })
    expect((await harness.run(request("read"))).reply).toMatchObject({
      owned: true,
      value: "dummy-staged-2",
      marker: true,
      present: { staging: false, old: true },
    })
    expect(await harness.fixture("read", ACCOUNT)).toContain("status -25293")

    expect((await harness.run({ v: 1, verb: "remove", account: OLD })).reply).toEqual({ ok: true })
    expect((await harness.run({ v: 1, verb: "remove", account: OLD })).reply).toEqual({ ok: true, missing: true })
  })

  test("retire onto an existing .old is skipped and loses nothing; promote onto an existing original refuses", async () => {
    expect((await harness.run(request("retire"))).reply).toEqual({ ok: true })
    expect((await harness.run(request("write", { value: "dummy-newer" }))).reply).toEqual({ ok: true, created: true })
    expect((await harness.run(request("retire"))).reply).toEqual({ ok: true, skipped: true })
    expect((await harness.run(request("read"))).reply).toMatchObject({ owned: true, value: "dummy-newer" })

    expect((await harness.run(request("stage", { value: "dummy-stage" }))).reply).toEqual({ ok: true, created: true })
    expect((await harness.run(request("promote"))).reply).toMatchObject({ error: "exists", status: -25299 })
    expect((await harness.run(request("read"))).reply).toMatchObject({ value: "dummy-newer", present: { staging: true, old: true } })

    for (const account of [STAGING, OLD, ACCOUNT])
      expect((await harness.run({ v: 1, verb: "remove", account })).reply).toEqual({ ok: true })
    expect((await harness.run(request("read"))).reply).toEqual({ missing: true, present: { staging: false, old: false } })
    expect((await harness.run(request("retire"))).reply).toMatchObject({ error: "missing" })
    expect((await harness.run(request("promote"))).reply).toMatchObject({ error: "missing" })
  })

  test("an item another identity created is never read, written, staged over or deleted", async () => {
    expect(await harness.fixture("add", ACCOUNT, "dummy-foreign")).toContain("status 0")

    const read = await harness.run(request("read"))
    expect(read.reply).toMatchObject({ owned: false, marker: false, present: { staging: false, old: false } })
    expect(read.reply).not.toHaveProperty("value")
    expect(typeof read.reply?.cdat).toBe("number")
    const neverOurs: unknown[] = ["none", "other"]
    expect(neverOurs).toContain(read.reply?.partition)

    expect((await harness.run(request("write", { value: "dummy-mine" }))).reply).toMatchObject({ error: "not-owned" })
    expect((await harness.run({ v: 1, verb: "remove", account: ACCOUNT })).reply).toMatchObject({ error: "not-owned" })
    expect(await harness.fixture("read", ACCOUNT)).toContain("value dummy-foreign")

    expect(await harness.fixture("add", STAGING, "dummy-foreign-staging")).toContain("status 0")
    expect((await harness.run(request("stage", { value: "dummy-mine" }))).reply).toMatchObject({ error: "not-owned", reason: "staging" })
    expect(await harness.fixture("read", STAGING)).toContain("value dummy-foreign-staging")

    expect(await harness.fixture("delete", STAGING)).toContain("status 0")
    expect(await harness.fixture("delete", ACCOUNT)).toContain("status 0")
  })

  test("a runtime-start rewrite of a helper-owned item keeps its access: updated in place, never re-created", async () => {
    expect((await harness.run(request("write", { value: "dummy-session-1" }))).reply).toEqual({ ok: true, created: true })
    const before = (await harness.run(request("read"))).reply
    for (const value of ["dummy-session-2", "dummy-session-3"])
      expect((await harness.run(request("write", { value }))).reply).toEqual({ ok: true })
    const after = (await harness.run(request("read"))).reply
    expect(after).toMatchObject({ owned: true, value: "dummy-session-3", marker: true, cdat: before?.cdat })
    expect(await harness.fixture("decrypt-apps", ACCOUNT)).toContain("decrypt-apps 1")
    expect(await harness.fixture("read", ACCOUNT)).toContain("status -25293")
    expect((await harness.run({ v: 1, verb: "remove", account: ACCOUNT })).reply).toEqual({ ok: true })
  })

  test("approve answers from <A> only and reports missing", async () => {
    expect((await harness.run(request("approve"))).reply).toEqual({ missing: true })
    expect((await harness.run(request("stage", { value: "dummy-staged-only" }))).reply).toEqual({ ok: true, created: true })
    expect((await harness.run(request("approve"))).reply).toEqual({ missing: true })
    expect((await harness.run(request("write", { value: "dummy-approved" }))).reply).toEqual({ ok: true, created: true })
    expect((await harness.run(request("approve"))).reply).toMatchObject({ value: "dummy-approved", marker: true })
    for (const account of [STAGING, ACCOUNT]) await harness.run({ v: 1, verb: "remove", account })
  })
})
