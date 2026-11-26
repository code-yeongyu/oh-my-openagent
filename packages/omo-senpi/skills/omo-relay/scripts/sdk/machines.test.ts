import { describe, expect, test } from "bun:test"
import { onEveryMachine, onMachine, onMachines } from "./index.ts"
import type { FleetPort, MachineRef, WaveContext, WaveOptions, WaveOutcome } from "./ports.ts"

type FakeMachine = MachineRef & { readonly unsupported?: boolean }

const rows: readonly FakeMachine[] = [
  { id: "id-a", alias: "device-a", state: "online" },
  { id: "id-b", alias: "device-b", state: "online" },
  { id: "id-c", alias: "device-c", state: "online" },
  { id: "id-d", alias: "device-d", state: "offline" },
]

// A fleet that behaves like the shipped client: offline targets are skipped before dispatch, a callback
// throw settles that target as rejected, and outcomes stream in settle order with their wave index.
function fakeFleet(machines: readonly FakeMachine[] = rows): FleetPort<FakeMachine> & { readonly waves: number[] } {
  const waves: number[] = []
  return {
    waves,
    listMachines: async () => machines,
    fanout<Value>(
      targets: readonly FakeMachine[] | "all",
      fn: (machine: FakeMachine, context: WaveContext) => Promise<Value>,
      _options?: WaveOptions,
    ): AsyncIterable<WaveOutcome<FakeMachine, Value>> {
      const list = targets === "all" ? machines : targets
      waves.push(list.length)
      return (async function* () {
        const settled = await Promise.all(
          list.map(async (machine, index): Promise<WaveOutcome<FakeMachine, Value>> => {
            if (machine.state === "offline") return { kind: "skipped", machine, reason: "machine_offline", index }
            try {
              return {
                kind: "fulfilled",
                machine,
                value: await fn(machine, { signal: new AbortController().signal }),
                index,
              }
            } catch (thrown) {
              if (thrown instanceof Error) return { kind: "rejected", machine, error: thrown, index }
              throw thrown
            }
          }),
        )
        yield* settled.reverse()
      })()
    },
  }
}

describe("onEveryMachine", () => {
  test("#given a wave where one callback throws #when it settles #then every machine has one outcome in wave order", async () => {
    // given
    const fleet = fakeFleet()

    // when
    const batch = await onEveryMachine(fleet, async (machine) => {
      if (machine.alias === "device-b") throw new Error("boom")
      return machine.alias
    })

    // then
    expect(batch.outcomes.map((outcome) => [outcome.target.alias, outcome.kind])).toEqual([
      ["device-a", "fulfilled"],
      ["device-b", "rejected"],
      ["device-c", "fulfilled"],
      ["device-d", "skipped"],
    ])
    expect(batch.ok).toBe(false)
    expect(batch.rejected[0]?.error.message).toBe("boom")
    expect(batch.skipped[0]?.reason).toBe("machine_offline")
  })
})

describe("onMachines", () => {
  test("#given three named machines and a throw on the second #when run #then outcomes keep input order", async () => {
    // given
    const fleet = fakeFleet()

    // when
    const batch = await onMachines(fleet, ["device-c", "id-b", "device-a"], async (machine) => {
      if (machine.id === "id-b")
        throw Object.assign(new Error("denied"), { code: "capability_missing", next_action: "ask" })
      return machine.id
    })

    // then
    expect(batch.outcomes.map((outcome) => outcome.kind)).toEqual(["fulfilled", "rejected", "fulfilled"])
    expect(batch.outcomes.map((outcome) => outcome.target)).toEqual(["device-c", "id-b", "device-a"])
    expect(batch.rejected[0]?.error).toEqual({ code: "capability_missing", message: "denied", next_action: "ask" })
    expect(batch.fulfilled.map((outcome) => outcome.value)).toEqual(["id-c", "id-a"])
  })

  test("#given an alias two machines share #when run #then it is rejected as ambiguous and never dispatched", async () => {
    // given
    const fleet = fakeFleet([...rows, { id: "id-e", alias: "device-a", state: "online" }])

    // when
    const batch = await onMachines(fleet, ["device-a"], async () => "ran")

    // then
    expect(batch.rejected[0]?.error.code).toBe("ambiguous")
    expect(fleet.waves).toEqual([])
  })

  test("#given a directory read that fails #when run #then every target is rejected with that cause", async () => {
    // given
    const fleet: FleetPort<FakeMachine> = {
      ...fakeFleet(),
      listMachines: async () => {
        throw Object.assign(new Error("no relay"), { code: "no_transport", next_action: "sign in" })
      },
    }

    // when
    const batch = await onMachines(fleet, ["device-a", "device-b"], async () => "ran")

    // then
    expect(batch.rejected.map((outcome) => [outcome.target, outcome.error.code])).toEqual([
      ["device-a", "no_transport"],
      ["device-b", "no_transport"],
    ])
  })
})

describe("onMachine", () => {
  test("#given an unknown alias #when run #then it answers rejected not_found without throwing", async () => {
    // when
    const outcome = await onMachine(fakeFleet(), "device-z", async () => "ran")

    // then
    expect(outcome.kind).toBe("rejected")
    expect(outcome.kind === "rejected" ? outcome.error.code : undefined).toBe("not_found")
  })

  test("#given an offline machine #when run #then it is skipped with the client's reason", async () => {
    // when
    const outcome = await onMachine(fakeFleet(), "device-d", async () => "ran")

    // then
    expect(outcome).toEqual({ kind: "skipped", target: "device-d", reason: "machine_offline" })
  })
})
