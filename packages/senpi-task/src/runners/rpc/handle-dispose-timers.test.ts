import { afterEach, expect, test } from "bun:test"

import { startHostHeartbeat } from "../rpc-host/handle-heartbeat"
import { fakeClock } from "./__fixtures__/clock"
import { silentChild } from "./__fixtures__/silent-child"
import { createRpcChildHandle } from "./handle"
import { startHeartbeat } from "./heartbeat"
import { RpcProtocolClient } from "./protocol-client"

let clock: ReturnType<typeof fakeClock>
afterEach(() => clock?.restore())

// #11673: a disposed stdio child owns no timer, and nothing it started before teardown can arm one after it.
// Each scenario tears the child (or its heartbeat) down, then returns every command or probe issued afterwards.
type Scenario = () => Promise<readonly string[]>

function stdioChild() {
  const fake = silentChild()
  const handle = createRpcChildHandle({
    client: new RpcProtocolClient({ child: fake.child }), child: fake.child,
    taskId: "st_dispose_timers", heartbeatIntervalMs: 10_000, now: clock.now,
    terminateChild: async () => { fake.child.emit("close", null, "SIGKILL") },
  })
  const disposed = async (): Promise<() => readonly string[]> => {
    await handle.dispose()
    const sent = fake.commands.length
    return () => fake.commands.slice(sent).map((command) => command.type)
  }
  return { fake, handle, disposed }
}

/** A teardown continuation already queued when the heartbeat tick runs settles before that tick's probe launch. */
function stopQueuedAheadOfTick(stop: () => void): { readonly paused: () => boolean; readonly arm: () => void } {
  let armed = false
  return {
    arm: () => { armed = true },
    paused: () => {
      if (armed) {
        armed = false
        queueMicrotask(stop)
      }
      return false
    },
  }
}

const scenarios: ReadonlyArray<readonly [string, Scenario]> = [
  ["a get_state probe in flight when dispose runs", async () => {
    const child = stdioChild()
    await clock.advance(10_000)
    expect(child.fake.commands.map((command) => command.type)).toContain("get_state")
    const late = await child.disposed()
    await clock.advance(0)
    return late()
  }],
  ["a child that exited before dispose", async () => {
    const child = stdioChild()
    child.fake.child.emit("close", 0, null)
    const late = await child.disposed()
    await clock.advance(0)
    return late()
  }],
  ["a finished turn adopted after dispose", async () => {
    const child = stdioChild()
    const late = await child.disposed()
    void child.handle.adoptFinishedTurn?.("done")
    await clock.advance(0)
    return late()
  }],
  ["an abort requested after dispose", async () => {
    const child = stdioChild()
    const late = await child.disposed()
    void child.handle.abort().catch(() => undefined)
    await clock.advance(0)
    return late()
  }],
  ["a steer delivered after dispose", async () => {
    const child = stdioChild()
    const late = await child.disposed()
    void Promise.resolve(child.handle.steer("late")).catch(() => undefined)
    await clock.advance(0)
    return late()
  }],
  ["a closed-pipe write error reported after dispose", async () => {
    const child = stdioChild()
    const late = await child.disposed()
    child.fake.child.stdin?.emit("error", Object.assign(new Error("closed pipe"), { code: "EPIPE" }))
    await clock.advance(0)
    return late()
  }],
  ["an extension UI request the child sends after dispose", async () => {
    const child = stdioChild()
    const late = await child.disposed()
    child.fake.emit({ type: "extension_ui_request", id: "ui-late", method: "confirm" })
    await clock.advance(0)
    return late()
  }],
  ["a stdio heartbeat stopped between its tick and the probe launch", async () => {
    const probes: string[] = []
    let stop = (): void => {}
    const gate = stopQueuedAheadOfTick(() => stop())
    stop = startHeartbeat({
      intervalMs: 10_000, paused: gate.paused,
      probe: () => { probes.push("get_state"); return new Promise((resolve) => setTimeout(resolve, 10_000)) },
      onState: () => {}, onFailure: () => {}, onUnresponsive: () => {},
    })
    gate.arm()
    await clock.advance(10_000)
    return probes
  }],
  ["a host heartbeat stopped between its tick and the probe launch", async () => {
    const probes: string[] = []
    let stop = (): void => {}
    const gate = stopQueuedAheadOfTick(() => stop())
    const heartbeat = startHostHeartbeat({
      taskId: "st_dispose_timers", intervalMs: 10_000, paused: gate.paused,
      probe: () => { probes.push("get_state"); return new Promise((resolve) => setTimeout(() => resolve({ sessionId: "durable-child" }), 10_000)) },
      onState: () => {}, onStatus: () => {}, close: async () => {}, onGone: () => {},
    })
    stop = heartbeat.stop
    gate.arm()
    await clock.advance(10_000)
    return probes
  }],
]

for (const [name, scenario] of scenarios) {
  test(`#given ${name} #when the teardown settles #then no command follows it and no timer stays armed`, async () => {
    clock = fakeClock()
    expect(await scenario()).toEqual([])
    expect(clock.pending()).toBe(0)
  })
}
