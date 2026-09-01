import { describe, expect, test } from "bun:test"

import { memoryModuleSupervisor } from "./supervisor"

describe("memoryModuleSupervisor", () => {
  test("#given multiple component sessions #when references acquire and release #then the placeholder remains ref-counted", () => {
    const before = memoryModuleSupervisor.refCount

    memoryModuleSupervisor.acquire()
    memoryModuleSupervisor.acquire()
    expect(memoryModuleSupervisor.refCount).toBe(before + 2)
    memoryModuleSupervisor.release()
    memoryModuleSupervisor.release()

    expect(memoryModuleSupervisor.refCount).toBe(before)
  })
})
