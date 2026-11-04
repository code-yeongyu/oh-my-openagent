import { describe, expect, it } from "bun:test"
import type { BunshinClient, StandaloneMachine } from "../../vendor/bunshin-ts/index.js"

import { createLazyBunshinClient } from "./bunshin-ts-default-client"

function fakeClient(closed: string[], name: string): BunshinClient {
  return {
    listMachines: async () => [{ id: name } as unknown as StandaloneMachine],
    close: async () => { closed.push(name) },
  } as unknown as BunshinClient
}

describe("bunshin-ts lazy default client", () => {
  it("#given the lazy client #when a property is read #then nothing connects until a method is awaited, and the connection is reused", async () => {
    let opens = 0
    const closed: string[] = []
    const client = createLazyBunshinClient(async () => fakeClient(closed, `c${++opens}`))
    expect(typeof client.listMachines).toBe("function")
    expect(opens).toBe(0)
    expect((await client.listMachines()).map((machine) => machine.id)).toEqual(["c1"])
    expect((await client.listMachines()).map((machine) => machine.id)).toEqual(["c1"])
    expect(opens).toBe(1)
    await client.close()
    expect(closed).toEqual(["c1"])
    expect((await client.listMachines()).map((machine) => machine.id)).toEqual(["c2"])
  })

  it("#given a connect that fails once #when called again #then the failure is not memoized", async () => {
    let attempts = 0
    const client = createLazyBunshinClient(async () => {
      attempts += 1
      if (attempts === 1) throw new Error("service not connected")
      return fakeClient([], "second")
    })
    await expect(client.listMachines()).rejects.toThrow("service not connected")
    expect((await client.listMachines()).map((machine) => machine.id)).toEqual(["second"])
    expect(attempts).toBe(2)
  })
})
