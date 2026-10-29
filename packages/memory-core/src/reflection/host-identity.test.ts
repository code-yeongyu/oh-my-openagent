import { describe, expect, test } from "bun:test"

import { classifyHostIdentity, createMachineIdReader } from "./host-identity"

const foreign = (recordedHostname: string, viaMachineId: boolean) => ({
  state: "foreign" as const,
  recordedHostname,
  viaMachineId,
})

describe("reflection host identity (#1793303560)", () => {
  test("#given equal machine ids #when classified #then the holder is local regardless of the hostnames", async () => {
    expect(await classifyHostIdentity({
      recordedHostname: "other-host",
      recordedMachineId: "machine-a",
      currentHostname: "this-host",
      currentMachineId: async () => "machine-a",
    })).toEqual({ state: "local" })
  })

  test("#given different machine ids #when classified #then the holder is foreign even when the hostnames match", async () => {
    expect(await classifyHostIdentity({
      recordedHostname: "this-host",
      recordedMachineId: "machine-a",
      currentHostname: "this-host",
      currentMachineId: async () => "machine-b",
    })).toEqual(foreign("this-host", true))
  })

  test("#given no recorded machine id #when classified #then hostname equality decides and the id is never read", async () => {
    let reads = 0
    const probe = async () => { reads += 1; return "machine-a" }
    expect(await classifyHostIdentity({
      recordedHostname: "this-host",
      recordedMachineId: undefined,
      currentHostname: "this-host",
      currentMachineId: probe,
    })).toEqual({ state: "local" })
    expect(await classifyHostIdentity({
      recordedHostname: "other-host",
      recordedMachineId: undefined,
      currentHostname: "this-host",
      currentMachineId: probe,
    })).toEqual(foreign("other-host", false))
    expect(reads).toBe(0)
  })

  test("#given a null current machine id #when classified #then hostname equality decides and a local holder stays local", async () => {
    expect(await classifyHostIdentity({
      recordedHostname: "this-host",
      recordedMachineId: "machine-a",
      currentHostname: "this-host",
      currentMachineId: async () => null,
    })).toEqual({ state: "local" })
    expect(await classifyHostIdentity({
      recordedHostname: "other-host",
      recordedMachineId: "machine-a",
      currentHostname: "this-host",
      currentMachineId: async () => null,
    })).toEqual(foreign("other-host", false))
  })

  test("#given a lookup that returns null then succeeds #when read repeatedly #then only the successful id is memoized", async () => {
    let attempts = 0
    const reader = createMachineIdReader(async () => {
      attempts += 1
      return attempts === 1 ? null : "machine-a"
    })
    expect(await reader()).toBeNull()
    expect(await reader()).toBe("machine-a")
    expect(await reader()).toBe("machine-a")
    expect(attempts).toBe(2)
  })

  test("#given a lookup that throws then succeeds #when read repeatedly #then the failure is not memoized", async () => {
    let attempts = 0
    const reader = createMachineIdReader(async () => {
      attempts += 1
      if (attempts === 1) throw new Error("timed out")
      return "machine-a"
    })
    expect(await reader()).toBeNull()
    expect(await reader()).toBe("machine-a")
    expect(attempts).toBe(2)
  })
})
