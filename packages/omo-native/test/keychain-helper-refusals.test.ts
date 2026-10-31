import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { ACCOUNT, createHarness, NATIVE_BUILD_BUDGET_MS, type Harness, isDarwin } from "./keychain-helper.test-support"

const MAX_VALUE = 65_536
const refused = (reason: string) => ({ error: "refused", reason })

const hexPlist = (partitions: readonly string[]): string =>
  Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">` +
      `<plist version="1.0"><dict><key>Partitions</key><array>${partitions.map(p => `<string>${p}</string>`).join("")}</array></dict></plist>`,
  ).toString("hex")

describe.skipIf(!isDarwin)("omo-keychain helper refusals (#11262 design 1, Refusals)", () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await createHarness()
  }, NATIVE_BUILD_BUDGET_MS)

  afterAll(async () => {
    await harness.dispose()
  }, NATIVE_BUILD_BUDGET_MS)

  const cases: ReadonlyArray<readonly [string, object | string, string]> = [
    ["uppercase account", { v: 1, verb: "read", account: "A".repeat(64) }, "account"],
    ["short account", { v: 1, verb: "read", account: "a".repeat(63) }, "account"],
    ["suffixed account on read", { v: 1, verb: "read", account: `${ACCOUNT}.staging` }, "account"],
    ["suffixed account on write", { v: 1, verb: "write", account: `${ACCOUNT}.old`, value: "x" }, "account"],
    ["unknown suffix on remove", { v: 1, verb: "remove", account: `${ACCOUNT}.backup` }, "account"],
    ["another service's account name", { v: 1, verb: "read", account: "device-keys-v1" }, "account"],
    ["unknown v", { v: 2, verb: "read", account: ACCOUNT }, "unknown-v"],
    ["string v", { v: "1", verb: "read", account: ACCOUNT }, "unknown-v"],
    ["fractional v", `{"v":1.0,"verb":"read","account":"${ACCOUNT}"}`, "unknown-v"],
    ["missing v", { verb: "read", account: ACCOUNT }, "unknown-v"],
    ["unknown key", { v: 1, verb: "read", account: ACCOUNT, keychain: "/tmp/x" }, "unknown-key"],
    ["duplicate key", `{"v":1,"verb":"read","verb":"write","account":"${ACCOUNT}"}`, "duplicate-key"],
    ["malformed JSON", `{"v":1,"verb":"read","account":`, "malformed"],
    ["trailing bytes", `{"v":1,"verb":"read","account":"${ACCOUNT}"} x`, "malformed"],
    ["lone surrogate", `{"v":1,"verb":"write","account":"${ACCOUNT}","value":"\\udc00"}`, "malformed"],
    ["unknown verb", { v: 1, verb: "export", account: ACCOUNT }, "unknown-verb"],
    ["a verb with an embedded NUL", { v: 1, verb: "write\u0000x", account: ACCOUNT, value: "x" }, "unknown-verb"],
    ["a key with an embedded NUL", { v: 1, verb: "read", account: ACCOUNT, "value\u0000zz": "x" }, "unknown-key"],
    ["write without a value", { v: 1, verb: "write", account: ACCOUNT }, "missing-value"],
    ["read with a value", { v: 1, verb: "read", account: ACCOUNT, value: "x" }, "extra-value"],
    ["value over 64 KiB", { v: 1, verb: "write", account: ACCOUNT, value: "x".repeat(MAX_VALUE + 1) }, "too-large"],
  ]

  test.each(cases)("refuses %s", async (_name, request, reason) => {
    const run = await harness.run(request)
    expect(run.reply).toEqual(refused(reason))
    expect(run.exitCode).toBe(3)
  })

  test("accepts a value of exactly 64 KiB", async () => {
    const value = "x".repeat(MAX_VALUE)
    expect((await harness.run({ v: 1, verb: "write", account: ACCOUNT, value })).reply).toEqual({ ok: true, created: true })
    expect((await harness.run({ v: 1, verb: "read", account: ACCOUNT })).reply).toMatchObject({ owned: true, value })
    expect((await harness.run({ v: 1, verb: "remove", account: ACCOUNT })).reply).toEqual({ ok: true })
  })

  test("refuses unknown argv in the test build", async () => {
    const run = await harness.run({ v: 1, verb: "read", account: ACCOUNT }, { args: ["--keychain", harness.keychain, "--verbose"] })
    expect(run.reply).toEqual(refused("argv"))
    expect(run.exitCode).toBe(2)
  })

  test("a release build takes no argv and carries none of the test-only flags", async () => {
    const release = await harness.buildFlavor("omo-keychain-release", { flavor: "release" })
    const run = await harness.run({ v: 1, verb: "read", account: ACCOUNT }, { binary: release, args: ["--keychain", harness.keychain] })
    expect(run.reply).toEqual(refused("argv"))
    expect(run.exitCode).toBe(2)
    // Only a request the helper refuses before any keychain call is sent to a release build: it would use the real keychain.
    const malformed = await harness.run({ v: 2, verb: "read", account: ACCOUNT }, { binary: release, args: [] })
    expect(malformed.reply).toEqual(refused("unknown-v"))
    const bytes = readFileSync(release).toString("latin1")
    for (const flag of ["--keychain", "--no-ui", "--hold-before-reply", "--as-root", "--classify-partition"])
      expect(bytes.includes(flag)).toBe(false)
  })

  test("Q5 switch: the default build serves root; the refuse-root build refuses it", async () => {
    const asRoot = ["--keychain", harness.keychain, "--no-ui", "--as-root"]
    expect((await harness.run({ v: 1, verb: "read", account: ACCOUNT }, { args: asRoot })).reply).toMatchObject({ missing: true })
    const refusing = await harness.buildFlavor("omo-keychain-refuse-root", { flavor: "test", refuseRoot: true })
    const run = await harness.run({ v: 1, verb: "read", account: ACCOUNT }, { binary: refusing, args: asRoot })
    expect(run.reply).toEqual(refused("root"))
    const asUser = await harness.run({ v: 1, verb: "read", account: ACCOUNT }, { binary: refusing })
    expect(asUser.reply).toMatchObject({ missing: true })
  })

  test.each([
    ["ours", ["teamid:523JNR86LZ"]],
    ["ours", ["apple-tool:", "teamid:523JNR86LZ"]],
    ["other", ["teamid:ABCDE12345"]],
    ["other", ["apple-tool:", "apple:"]],
  ] as const)("classifies a partition list as %s", async (kind, partitions) => {
    const child = Bun.spawn([harness.helper, "--classify-partition", hexPlist(partitions)], { stdout: "pipe", env: {} })
    expect((await new Response(child.stdout).text()).trim()).toBe(kind)
  })

  test("an unreadable partition description is unknown, never ours", async () => {
    const child = Bun.spawn([harness.helper, "--classify-partition", "zz"], { stdout: "pipe", env: {} })
    expect((await new Response(child.stdout).text()).trim()).toBe("unknown")
  })
})
