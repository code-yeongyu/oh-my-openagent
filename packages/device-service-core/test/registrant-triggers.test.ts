import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { deviceServiceEndpointPath } from "../src/device-service.ts"
import type { RegistrantSchedule } from "../src/registrant.ts"
import type { FakeOwner } from "./local-api/conformance/fake-owner.ts"
import { AGENT_DIR, ownerAt, recorder, registeredFor, registers, root, SELF, start, stopOwner, useRegistrantWorld, within } from "./registrant-support.ts"

// #12379: the registrant registers on every proven connection to a service that starts,
// restarts or reappears, through a watcher armed before the existence check and the connection's own close, and it
// schedules nothing but the bounded connect retries.

useRegistrantWorld()

describe("agent dir registrant: service starts (#12379)", () => {
  test("registers the engine's own agent dir, byte for byte, right after the proof on a running service", async () => {
    const stateDir = join(root(), "device-service")
    const owner = await ownerAt(stateDir)
    const seen = recorder()
    const registered = seen.next(registeredFor(SELF), "the register for the adopted device")
    start({ stateDir, onEvent: seen.onEvent })

    await registered
    expect([...owner.state.endpoints]).toEqual([AGENT_DIR])
    expect(seen.events.filter(event => event.kind === "registered").map(event => event.deviceId)).toEqual([null, SELF])
    expect(registers(owner)).toBe(2)
  })


  test("a fresh service on the same state dir (a relayd restart) gets the register again on its new connection", async () => {
    const stateDir = join(root(), "device-service")
    const first = await ownerAt(stateDir)
    const seen = recorder()
    const firstRegister = seen.next(registeredFor(SELF), "the register for the adopted device")
    start({ stateDir, onEvent: seen.onEvent })
    await firstRegister

    const disconnected = seen.next(event => event.kind === "disconnected", "the connection closing")
    await stopOwner(first)
    await disconnected
    const again = seen.next(registeredFor(SELF), "the register after the restart")
    const second = await ownerAt(stateDir)

    await again
    expect([...second.state.endpoints]).toEqual([AGENT_DIR])
    expect(registers(second)).toBe(2)
  })


  test("a back-to-back stop and start is caught by the connection's close even when no file event arrives", async () => {
    const stateDir = join(root(), "device-service")
    const first = await ownerAt(stateDir)
    const seen = recorder()
    const firstRegister = seen.next(registeredFor(SELF), "the register for the adopted device")
    // A watcher whose create event is lost or coalesced with the old socket's removal: only the close can trigger.
    start({ stateDir, onEvent: seen.onEvent, watchEndpoint: () => () => {} })
    await firstRegister

    const again = seen.next(registeredFor(SELF), "the register after the back-to-back restart")
    await stopOwner(first)
    const second = await ownerAt(stateDir)

    await again
    expect([...second.state.endpoints]).toEqual([AGENT_DIR])
  })


  test("a state dir that does not exist yet (relayd installed after the engine started) is watched from its nearest ancestor", async () => {
    const stateDir = join(root(), "home", ".omo", "device-service")
    const seen = recorder()
    const registered = seen.next(registeredFor(SELF), "the register once the service starts")
    start({ stateDir, onEvent: seen.onEvent })

    const owner = await ownerAt(stateDir)

    await registered
    expect([...owner.state.endpoints]).toEqual([AGENT_DIR])
  })


  test("a service that starts between arming the watcher and the existence check is not missed", async () => {
    const stateDir = join(root(), "device-service")
    mkdirSync(stateDir, { mode: 0o700 })
    const seen = recorder()
    const registered = seen.next(registeredFor(SELF), "the register of a service started in the gap")
    let started: Promise<FakeOwner> | undefined
    start({
      stateDir,
      onEvent: seen.onEvent,
      // Runs once between the two start-up steps, whatever their order: a registrant that checks before it arms
      // misses this service, because the socket appears after its check and before its watcher.
      startupGap: async () => {
        started = ownerAt(stateDir)
        await started
      },
    })

    await registered
    const owner = await started
    expect(owner === undefined ? [] : [...owner.state.endpoints]).toEqual([AGENT_DIR])
  })


  test("schedules nothing without a trigger, and only the 250 ms / 1 s / 4 s connect retries for a dead endpoint", async () => {
    const stateDir = join(root(), "device-service")
    mkdirSync(stateDir, { mode: 0o700 })
    // An endpoint nobody listens on: what a relayd that crashed leaves behind. It must be the platform's own
    // endpoint path (a socket on POSIX, endpoint.json on Windows), or the registrant never sees an endpoint at all.
    writeFileSync(deviceServiceEndpointPath(stateDir), "")
    const scheduled: number[] = []
    let onScheduled: ((run: () => void) => void) | undefined
    const nextScheduled = (what: string): Promise<() => void> =>
      within(new Promise<() => void>(resolve => (onScheduled = resolve)), what)
    const schedule: RegistrantSchedule = (run, ms) => {
      scheduled.push(ms)
      onScheduled?.(run)
      return () => {}
    }
    const seen = recorder()
    const gaveUp = seen.next(event => event.kind === "gave_up", "the registrant giving up until the next trigger")
    let retry = nextScheduled("retry 1 being scheduled")
    start({ stateDir, onEvent: seen.onEvent, schedule })

    for (let attempt = 2; attempt <= 4; attempt += 1) {
      const run = await retry
      if (attempt < 4) retry = nextScheduled(`retry ${attempt} being scheduled`)
      run()
    }

    await gaveUp
    expect(scheduled).toEqual([250, 1_000, 4_000])
    expect(seen.events.filter(event => event.kind === "connect_failed")).toHaveLength(4)
  })


  test("stop closes the connection and the watcher: a later service start registers nothing", async () => {
    const stateDir = join(root(), "device-service")
    const first = await ownerAt(stateDir)
    const seen = recorder()
    const registered = seen.next(registeredFor(SELF), "the register for the adopted device")
    const registrant = start({ stateDir, onEvent: seen.onEvent })
    await registered

    registrant.stop()
    await stopOwner(first)
    const seenByFresh = recorder()
    const freshRegistered = seenByFresh.next(registeredFor(SELF), "a live registrant's register on the new service")
    const second = await ownerAt(stateDir)
    start({ stateDir, onEvent: seenByFresh.onEvent })
    await freshRegistered

    expect(registers(second)).toBe(2)
    expect(seen.events.filter(event => event.kind === "registered")).toHaveLength(2)
  })


  test("never holds the engine process open", async () => {
    const stateDir = join(root(), "device-service")
    const owner = await ownerAt(stateDir)
    const script = join(root(), "hold.ts")
    writeFileSync(
      script,
      [
        `import { startAgentDirRegistrant } from ${JSON.stringify(join(import.meta.dir, "..", "src", "registrant.ts"))}`,
        `const hold = setInterval(() => {}, 1 << 30)`,
        `startAgentDirRegistrant({ version: "5.1.60", agentDir: ${JSON.stringify(AGENT_DIR)}, stateDir: ${JSON.stringify(stateDir)},`,
        `  onEvent: event => { if (event.kind === "registered" && event.deviceId === "dev-self") { console.log("REGISTERED"); clearInterval(hold) } } })`,
      ].join("\n"),
    )
    const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "inherit"] })
    let stdout = ""
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk
    })
    const exitCode = await within(new Promise<number | null>(resolve => child.once("close", resolve)), "the engine stand-in to exit on its own")

    expect(exitCode).toBe(0)
    expect(stdout.trim()).toBe("REGISTERED")
    expect([...owner.state.endpoints]).toEqual([AGENT_DIR])
  })

})
