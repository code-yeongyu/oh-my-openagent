import { describe, expect, test } from "bun:test"

import { classifyHostIdentity, createMachineHashReader, createMachineIdReader, reflectionHostHash } from "./host-identity"

const foreign = (viaMachineId: boolean) => ({ state: "foreign" as const, viaMachineId })

describe("reflection host identity (#1793303560)", () => {
  test("#given equal machine hashes #when classified #then the holder is local regardless of the hostnames", async () => {
    expect(await classifyHostIdentity({
      launcherHostname: "other-host",
      launcherMachineHash: "machine-a",
      hostname: "this-host",
      machineHash: async () => "machine-a",
    })).toEqual({ state: "local" })
  })

  test("#given different machine hashes #when classified #then the holder is foreign even when the hostnames match", async () => {
    expect(await classifyHostIdentity({
      launcherHostname: "this-host",
      launcherMachineHash: "machine-a",
      hostname: "this-host",
      machineHash: async () => "machine-b",
    })).toEqual(foreign(true))
  })

  test("#given no recorded machine hash #when classified #then hostname equality decides and the id is never read", async () => {
    let reads = 0
    const probe = async () => { reads += 1; return "machine-a" }
    expect(await classifyHostIdentity({
      launcherHostname: "this-host",
      launcherMachineHash: undefined,
      hostname: "this-host",
      machineHash: probe,
    })).toEqual({ state: "local" })
    expect(await classifyHostIdentity({
      launcherHostname: "other-host",
      launcherMachineHash: undefined,
      hostname: "this-host",
      machineHash: probe,
    })).toEqual(foreign(false))
    expect(reads).toBe(0)
  })

  test("#given no recorded hostname or a non-string recorded hash #when classified #then the holder is foreign or hostname equality decides, and the id is never read", async () => {
    const probe = async () => { throw new Error("machine id must not be read") }
    expect(await classifyHostIdentity({ launcherHostname: undefined, launcherMachineHash: "machine-a", hostname: "this-host", machineHash: probe }))
      .toEqual(foreign(false))
    expect(await classifyHostIdentity({ launcherHostname: "this-host", launcherMachineHash: 42, hostname: "this-host", machineHash: probe }))
      .toEqual({ state: "local" })
  })

  test("#given a null current machine hash #when classified #then hostname equality decides and a local holder stays local", async () => {
    expect(await classifyHostIdentity({
      launcherHostname: "this-host",
      launcherMachineHash: "machine-a",
      hostname: "this-host",
      machineHash: async () => null,
    })).toEqual({ state: "local" })
    expect(await classifyHostIdentity({
      launcherHostname: "other-host",
      launcherMachineHash: "machine-a",
      hostname: "this-host",
      machineHash: async () => null,
    })).toEqual(foreign(false))
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

  // Storage/security contract: the platform id is hashed with the reflection domain before anyone sees it.
  test("#given a platform id #when read through the hash reader #then only its domain-separated sha256 comes out", async () => {
    const raw = "synthetic-platform-id-0001"
    const hash = await createMachineHashReader(async () => raw)()
    expect(hash).toBe(new Bun.CryptoHasher("sha256").update(`omo-reflection-host:${raw}`).digest("hex"))
    expect(hash).toBe(reflectionHostHash(raw))
    expect(await createMachineHashReader(async () => null)()).toBeNull()
  })
})
