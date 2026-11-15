import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { deviceServiceEndpointPath } from "../src/device-service.ts"
import {
  AGENT_DIR,
  deafWatch,
  otherClient,
  ownerAt,
  recorder,
  registeredFor,
  registers,
  root,
  SELF,
  start,
  stopOwner,
  useRegistrantWorld,
} from "./registrant-support.ts"

// #12733: once the endpoint the registrant knew is gone, it waits for the next one on a freshly armed watch, so a
// service that comes right back is found by that arm's settle re-check. In these cases the directory watch never
// reports anything (its notification was measured seconds to tens of seconds late on macOS under file churn), and the
// test runs the pending settle itself, so nothing here waits on the operating system or on a timer.

useRegistrantWorld()

describe("agent dir registrant: a service that comes back while the watch stays silent (#12733)", () => {
  test("a service that stopped and came back gets the register again on its new connection", async () => {
    // given
    const stateDir = join(root(), "device-service")
    const first = await ownerAt(stateDir)
    const seen = recorder()
    const firstRegister = seen.next(registeredFor(SELF), "the register for the adopted device")
    const watch = deafWatch()
    start({ stateDir, onEvent: seen.onEvent, watchEndpoint: watch.watchEndpoint })
    await firstRegister
    const disconnected = seen.next((event) => event.kind === "disconnected", "the connection closing")
    await stopOwner(first)
    await disconnected

    // when
    const again = seen.next(registeredFor(SELF), "the register after the unreported restart")
    const second = await ownerAt(stateDir)
    watch.runSettles()

    // then
    await again
    expect([...second.state.endpoints]).toEqual([AGENT_DIR])
    expect(registers(second)).toBe(2)
  })

  test("a service that starts after the endpoint vanished under a failing connect is registered with", async () => {
    // given
    const stateDir = join(root(), "device-service")
    mkdirSync(stateDir, { mode: 0o700 })
    const endpoint = deviceServiceEndpointPath(stateDir)
    writeFileSync(endpoint, "")
    const seen = recorder()
    const gaveUp = seen.next((event) => event.kind === "gave_up", "the registrant giving up on the vanished endpoint")
    const watch = deafWatch()
    start({
      stateDir,
      watchEndpoint: watch.watchEndpoint,
      // The endpoint goes away as the connect to it fails: a stopping service seen from another process, where the
      // close can arrive before the socket file is removed.
      onEvent: (event) => {
        if (event.kind === "connect_failed") rmSync(endpoint, { force: true })
        seen.onEvent(event)
      },
    })
    await gaveUp

    // when
    const registered = seen.next(registeredFor(SELF), "the register on the service that started later")
    const owner = await ownerAt(stateDir)
    watch.runSettles()

    // then
    await registered
    expect([...owner.state.endpoints]).toEqual([AGENT_DIR])
  })

  test("an endpoint that appears between the failed connect's existence check and the re-arm is connected to", async () => {
    // given
    const stateDir = join(root(), "device-service")
    mkdirSync(stateDir, { mode: 0o700 })
    const endpoint = deviceServiceEndpointPath(stateDir)
    writeFileSync(endpoint, "")
    const owner = await ownerAt(join(root(), "device-service"))
    const seen = recorder()
    const registered = seen.next(registeredFor(SELF), "the register on the service whose endpoint appeared in the gap")
    const watch = deafWatch()
    let connects = 0
    let arms = 0

    // when
    start({
      stateDir,
      // The first connect is refused; the next one reaches the service that came back.
      connect: () => (connects++ === 0 ? Promise.reject(new Error("refused")) : otherClient(owner.stateDir)),
      // The second arm is the re-arm: the returning service's endpoint is in place just before it, so that arm sees
      // an endpoint, its settle stays silent, and only the existence check after the arm can find the service.
      watchEndpoint: (path, onChange) => {
        if (arms++ === 1) writeFileSync(endpoint, "")
        return watch.watchEndpoint(path, onChange)
      },
      onEvent: (event) => {
        if (event.kind === "connect_failed") rmSync(endpoint, { force: true })
        seen.onEvent(event)
      },
    })

    // then
    await registered
    expect([...owner.state.endpoints]).toEqual([AGENT_DIR])
  })
})
