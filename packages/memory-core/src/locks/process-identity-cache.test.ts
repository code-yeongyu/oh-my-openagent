import { describe, expect, test } from "bun:test"
import { createProcessStartIdentityReader } from "./process-identity"

const OWN_PID = 123
const OTHER_PID = 456

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

describe("process start identity cache", () => {
  test("#given concurrent own-process probes #when the OS answers #then one lookup serves every caller and later locks", async () => {
    const answer = deferred<string | null>()
    const calls: number[] = []
    const read = createProcessStartIdentityReader((pid) => {
      calls.push(pid)
      return answer.promise
    }, OWN_PID)
    const first = read(OWN_PID)
    const second = read(OWN_PID)
    answer.resolve("win32-creation-date:original")
    expect(await Promise.all([first, second])).toEqual([
      "win32-creation-date:original", "win32-creation-date:original",
    ])
    expect(await read(OWN_PID)).toBe("win32-creation-date:original")
    expect(calls).toEqual([OWN_PID])
  })

  test("#given an unavailable own identity #when a later request probes #then unknown is not cached", async () => {
    const answers = [null, "win32-creation-date:recovered"]
    let calls = 0
    const read = createProcessStartIdentityReader(async () => {
      calls++
      return answers.shift() ?? null
    }, OWN_PID)
    expect(await read(OWN_PID)).toBeNull()
    expect(await read(OWN_PID)).toBe("win32-creation-date:recovered")
    expect(await read(OWN_PID)).toBe("win32-creation-date:recovered")
    expect(calls).toBe(2)
  })

  test("#given a rejected own lookup #when requested again #then the error propagates and the lookup is not poisoned", async () => {
    const failure = new Error("OS lookup failed")
    let calls = 0
    const read = createProcessStartIdentityReader(async () => {
      if (++calls === 1) throw failure
      return "win32-creation-date:recovered"
    }, OWN_PID)
    await expect(read(OWN_PID)).rejects.toBe(failure)
    expect(await read(OWN_PID)).toBe("win32-creation-date:recovered")
    expect(calls).toBe(2)
  })

  test("#given another pid is reused or exits #when ownership is checked again #then every check reads the OS", async () => {
    const answers = ["win32-creation-date:first", "win32-creation-date:reused", null]
    const calls: number[] = []
    const read = createProcessStartIdentityReader(async (pid) => {
      calls.push(pid)
      return answers.shift() ?? null
    }, OWN_PID)
    expect(await read(OTHER_PID)).toBe("win32-creation-date:first")
    expect(await read(OTHER_PID)).toBe("win32-creation-date:reused")
    expect(await read(OTHER_PID)).toBeNull()
    expect(calls).toEqual([OTHER_PID, OTHER_PID, OTHER_PID])
  })
})
