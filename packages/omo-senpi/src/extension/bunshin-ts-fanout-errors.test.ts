import { describe, expect, it } from "bun:test"

import {
  BunshinFacade,
  FanoutDuplicateTargetError,
  FanoutOptionsError,
  FanoutTimeoutError,
  MachineNotFoundError,
  type BunshinClient,
  type StandaloneMachine,
  type StandaloneMachineHub,
} from "../../vendor/bunshin-ts/index.js"

import { createLazyBunshinClient } from "./bunshin-ts-default-client"
import { BunshinSessionError } from "./bunshin-ts-errors"

const STUDIO = {
  id: "dev-1",
  alias: "studio",
  kind: "enrolled",
  state: "online",
  routes: [],
  tags: [],
  shell: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  withToken: () => STUDIO,
} as unknown as StandaloneMachine

// A real facade over a one-machine directory, so fanout resolves, plans and times out through the vendored code.
function fleetClient(): BunshinClient {
  const hub = {
    refresh: async () => {},
    listMachines: () => [STUDIO],
    getMachine: (lookup: string) => {
      if (lookup === STUDIO.id || lookup === STUDIO.alias) return STUDIO
      throw new MachineNotFoundError(lookup)
    },
  } as unknown as StandaloneMachineHub
  return createLazyBunshinClient(async () => new BunshinFacade(hub))
}

const rejectionOf = async (pending: PromiseLike<unknown>): Promise<BunshinSessionError> => {
  const caught: unknown = await Promise.resolve(pending).then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(caught).toBeInstanceOf(BunshinSessionError)
  return caught as BunshinSessionError
}

describe("bunshin-ts fanout run failures", () => {
  it("#given an unknown target #when the fanout is awaited or iterated #then it rejects typed, naming fanout, with the lookup error as cause", async () => {
    const client = fleetClient()
    const awaited = await rejectionOf(client.fanout(["ghost"], async (machine) => machine.id))
    expect(awaited.code).toBe("not_found")
    expect(awaited.next_action).toContain("bunshin.listMachines()")
    expect(awaited.message).toContain("fanout on the fleet failed")
    expect(awaited.cause).toBeInstanceOf(MachineNotFoundError)
    const iterated = await rejectionOf(
      (async () => {
        for await (const outcome of client.fanout(["ghost"], async (machine) => machine.id))
          expect(outcome).toBeUndefined()
      })(),
    )
    expect(iterated.code).toBe("not_found")
  })

  it("#given a duplicate target under dedup reject #when the fanout runs #then it is invalid_arguments with the duplicate error as cause", async () => {
    const failure = await rejectionOf(
      fleetClient().fanout(["studio", "dev-1"], async (machine) => machine.id, { dedup: "reject" }),
    )
    expect(failure.code).toBe("invalid_arguments")
    expect(failure.next_action).toContain("fanout")
    expect(failure.cause).toBeInstanceOf(FanoutDuplicateTargetError)
  })

  it("#given invalid fanout options #when the fanout runs #then it is invalid_arguments with the options error as cause", async () => {
    const failure = await rejectionOf(
      fleetClient().fanout(["studio"], async (machine) => machine.id, { concurrency: 0 }),
    )
    expect(failure.code).toBe("invalid_arguments")
    expect(failure.next_action).toContain("fix the arguments of fanout")
    expect(failure.cause).toBeInstanceOf(FanoutOptionsError)
  })

  it("#given a target that exceeds timeoutMs #when the fanout settles #then that target's error is a typed timeout naming the device", async () => {
    const run = fleetClient().fanout(["studio"], () => new Promise<never>(() => {}), { timeoutMs: 5 })
    const result = await run
    const [entry] = result.rejected
    expect(entry?.error).toBeInstanceOf(BunshinSessionError)
    const failure = entry?.error as BunshinSessionError
    expect(failure.code).toBe("timeout")
    expect(failure.message).toContain("fanout on studio failed")
    expect(failure.next_action).toContain("timeoutMs")
    expect(failure.cause).toBeInstanceOf(FanoutTimeoutError)
    const streamed: unknown[] = []
    for await (const outcome of run) if (outcome.kind === "rejected") streamed.push(outcome.error)
    expect(streamed).toHaveLength(1)
    expect(streamed[0]).toBeInstanceOf(BunshinSessionError)
  })

  it("#given a callback that throws its own error #when the fanout settles #then that error is reported as thrown, not rewrapped", async () => {
    const own = new Error("my own check failed")
    const result = await fleetClient().fanout(["studio"], async () => {
      throw own
    })
    expect(result.rejected.map((entry) => entry.error)).toEqual([own])
  })
})

describe("bunshin-ts resultOf failures", () => {
  it("#given resultOf fails #when the error is read #then it names resultOf and the request, never the op id as the device", async () => {
    const client = createLazyBunshinClient(
      async () =>
        ({
          resultOf: async () => {
            throw new Error("hub lost the result")
          },
        }) as unknown as BunshinClient,
    )
    const failure = await rejectionOf(client.resultOf("op-zz"))
    expect(failure.message).toContain("resultOf on the fleet failed")
    expect(failure.message).not.toContain("on op-zz")
    expect(failure.details).toMatchObject({ operation: "resultOf", device: "the fleet", request_id: "op-zz" })
  })
})
