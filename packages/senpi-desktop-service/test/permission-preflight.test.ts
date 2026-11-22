import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DesktopService } from "../src/service/service"
import { fakeEngineFactory } from "./harness"

// Every case waits on real child-process I/O; the guard only catches a hang, it never times behavior.
const HANG_GUARD = { timeout: 30_000 }

let dir = ""
let tccFile = ""
let spawnLog = ""
const services: DesktopService[] = []

/** Pids of every fake engine started so far: the long-lived child and each fresh probe. */
const spawned = (): string[] =>
  readFileSync(spawnLog, "utf8")
    .split("\n")
    .filter((line) => line !== "")

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "permission-preflight-"))
  tccFile = path.join(dir, "tcc")
  spawnLog = path.join(dir, "spawned")
  writeFileSync(spawnLog, "")
  // The fresh probe re-runs the long-lived child's own command line with this process's environment.
  vi.stubEnv("FAKE_ENGINE_TCC_FILE", tccFile)
  vi.stubEnv("FAKE_ENGINE_SPAWN_LOG", spawnLog)
})

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()))
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

function serviceWithLog(): { service: DesktopService; log: ReturnType<typeof fakeEngineFactory> } {
  const log = fakeEngineFactory()
  const service = new DesktopService({ createChild: log.factory })
  services.push(service)
  return { service, log }
}

describe("session-open permission preflight", HANG_GUARD, () => {
  it("re-probes a fresh engine after a denial, so a grant counts without restarting the long-lived child", async () => {
    // Given: the long-lived child started while permissions were denied and caches that answer.
    writeFileSync(tccFile, "denied")
    const { service, log } = serviceWithLog()
    const first = await service.open({})
    expect(first.capturePermission).toBe("denied")
    expect(spawned()).toHaveLength(1)

    // When: the user grants, then the session is opened again on the same child.
    writeFileSync(tccFile, "granted")
    const second = await service.open({})

    // Then: the fresh process's answer is used and the long-lived child kept running.
    expect(second).toMatchObject({
      capturePermission: "granted",
      inputPermission: "granted",
      axPermission: "granted",
      capture: true,
      input: true,
      ax: true,
      displayCount: 1,
    })
    expect((await log.nthRequest("session.open", 2)).child).toBe(0)
    expect(log.children).toHaveLength(1)
    expect(log.kills()).toBe(0)
    expect(spawned()).toHaveLength(2)

    // And: the child still caches its denial, so every later open probes again and keeps the grant.
    const third = await service.open({})
    const fourth = await service.open({})
    expect([third.capturePermission, fourth.capturePermission]).toEqual(["granted", "granted"])
    expect(spawned()).toHaveLength(4)
    expect(log.children).toHaveLength(1)
  })

  it("keeps the denial when the fresh process is denied too", async () => {
    // Given
    writeFileSync(tccFile, "denied")
    const { service } = serviceWithLog()
    await service.open({})

    // When
    const second = await service.open({})

    // Then
    expect(second).toMatchObject({ capturePermission: "denied", capture: false, input: false, displayCount: 0 })
    expect(spawned()).toHaveLength(2)
  })

  it("starts no probe while the child's last answer was a grant", async () => {
    // Given
    writeFileSync(tccFile, "granted")
    const { service } = serviceWithLog()
    await service.open({})

    // When
    const second = await service.open({})

    // Then
    expect(second.capturePermission).toBe("granted")
    expect(spawned()).toHaveLength(1)
  })
})
