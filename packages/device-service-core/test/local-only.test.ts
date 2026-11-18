// Security contract (omo#13440): while a process is marked local-only, an owned network call site refuses with a typed
// error naming the site; unmarked processes are untouched; every bundled copy of the module shares one mark.
import { afterEach, describe, expect, test } from "bun:test"
import { isLocalOnlyProcess, LocalOnlyNetworkRefused, markLocalOnlyProcess, refuseIfLocalOnly } from "../src/local-only"

afterEach(() => {
  const holder = globalThis as { [key: symbol]: { marked: boolean } | undefined }
  const mark = holder[Symbol.for("omo.local-only-process.v1")]
  if (mark !== undefined) mark.marked = false
})

describe("local-only process mark", () => {
  test("#given an unmarked process #when a call site checks #then nothing is refused", () => {
    // given / when / then
    expect(isLocalOnlyProcess()).toBe(false)
    expect(() => refuseIfLocalOnly("protocol.requestApi")).not.toThrow()
  })

  test("#given a marked process #when a call site checks #then it refuses with a typed error naming the site", () => {
    // given
    markLocalOnlyProcess()

    // when
    let refused: unknown
    try {
      refuseIfLocalOnly("release.acquire")
    } catch (error) {
      refused = error
    }

    // then
    expect(refused).toBeInstanceOf(LocalOnlyNetworkRefused)
    expect(refused).toMatchObject({ code: "local_only_network_refused", site: "release.acquire" })
  })

  test("#given a second bundled copy of the module #when the first copy marks the process #then the copy sees the mark", async () => {
    // given
    const copy = (await import(`../src/local-only.ts?copy=${Date.now()}`)) as typeof import("../src/local-only")

    // when
    markLocalOnlyProcess()

    // then
    expect(copy.isLocalOnlyProcess()).toBe(true)
    expect(() => copy.refuseIfLocalOnly("session.refresh")).toThrow()
  })
})
