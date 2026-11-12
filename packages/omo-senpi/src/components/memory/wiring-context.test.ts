import { describe, expect, it } from "bun:test"
import { branchEntryCount, readUi } from "./wiring-context"

describe("branchEntryCount", () => {
  it("#given a session manager exposing getEntryCount #when the count is read #then entries are never materialized", () => {
    const eventCtx = {
      sessionManager: {
        getEntryCount: () => 7,
        getEntries: () => {
          throw new Error("getEntries must not be called when getEntryCount exists")
        },
      },
    }

    expect(branchEntryCount(eventCtx)).toBe(7)
  })

  it("#given a session manager without getEntryCount #when the count is read #then it falls back to getEntries().length", () => {
    const eventCtx = { sessionManager: { getEntries: () => [1, 2, 3] } }

    expect(branchEntryCount(eventCtx)).toBe(3)
  })

  it("#given no session manager #when the count is read #then it is zero", () => {
    expect(branchEntryCount({})).toBe(0)
    expect(branchEntryCount(undefined)).toBe(0)
  })
})

describe("readUi status publishing (#13046)", () => {
  it("#given refreshes that land in any order #when the same status text is published repeatedly #then the host sees each distinct text once and every clear", () => {
    const published: Array<string | undefined> = []
    const host = { ui: { setStatus: (_key: string, text?: string) => published.push(text), notify: () => undefined } }

    // Two readUi handles for one host ui share the last-published text, as every footer path does.
    const first = readUi(host)
    const second = readUi(host)
    first?.setStatus("memory", undefined)
    first?.setStatus("memory", "mem:project just now")
    second?.setStatus("memory", "mem:project just now")
    first?.setStatus("memory", "mem:project just now")
    second?.setStatus("memory", "mem:project just now (+1)")
    first?.setStatus("memory", undefined)
    second?.setStatus("memory", "mem:project just now")

    expect(published).toEqual([
      undefined,
      "mem:project just now",
      "mem:project just now (+1)",
      undefined,
      "mem:project just now",
    ])
  })

  it("#given two status keys on one host #when each publishes the same text #then the keys are deduplicated independently", () => {
    const published: Array<[string, string | undefined]> = []
    const host = {
      ui: { setStatus: (key: string, text?: string) => published.push([key, text]), notify: () => undefined },
    }

    const ui = readUi(host)
    ui?.setStatus("memory", "a")
    ui?.setStatus("loop", "a")
    ui?.setStatus("memory", "a")

    expect(published).toEqual([
      ["memory", "a"],
      ["loop", "a"],
    ])
  })

  it("#given a host setStatus that throws once #when the same text is published again #then it is retried, because a line the host never showed is not remembered", () => {
    const published: Array<string | undefined> = []
    let failNext = true
    const host = {
      ui: {
        setStatus: (_key: string, text?: string) => {
          if (failNext) {
            failNext = false
            throw new Error("host unavailable")
          }
          published.push(text)
        },
        notify: () => undefined,
      },
    }

    const ui = readUi(host)
    expect(() => ui?.setStatus("memory", "mem:project just now")).toThrow("host unavailable")
    ui?.setStatus("memory", "mem:project just now")

    expect(published).toEqual(["mem:project just now"])
  })
})
