import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { guardSecrets } from "./credential-store-test-guard"
import { createDeviceServiceGuard } from "./device-service-test-guard"
import { credentialStoreGuard, deviceServiceGuard, guardedStateDir } from "./real-account-test-guard.preload"

// Security contract: no test process dials this machine's own device service (the one serving the developer's sign-in).

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const realDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "omo-guarded-service-"))
  dirs.push(dir)
  return dir
}

describe("credential store test guard", () => {
  test("#given the real OS store (not marked injected) #when a test reads it #then the call is refused, never reaches it, and is recorded", async () => {
    const reached: string[] = []
    const real = { get: async () => reached.push("get") }
    const guarded = guardSecrets(real)

    await expect(Reflect.get(Object(guarded.secrets), "get")({ service: "omo", name: "session" })).rejects.toThrow(
      /real OS credential store/,
    )
    expect(reached).toEqual([])
    expect(guarded.takeViolations()).toHaveLength(1)
  })

  test("#given a store marked injected (a fake) #when guarded #then it is used as it is", () => {
    const fake = { get: async () => null, [Symbol.for("omo.test.injectedSecrets")]: true }
    expect(guardSecrets(fake).secrets).toBe(fake)
  })

  test("#given this process's preload #when the test reads Bun.secrets #then no violation is recorded (the store is a fake)", async () => {
    await Bun.secrets.get({ service: "omo-guard-probe", name: "probe" })
    expect(credentialStoreGuard.takeViolations()).toEqual([])
  })
})

describe("device-service test guard routes", () => {
  test("#given a symlink to the guarded dir #when a test dials the socket through it #then it is refused", () => {
    const dir = realDir()
    const link = join(realDir(), "link")
    symlinkSync(dir, link)
    const guard = createDeviceServiceGuard(dir)

    expect(() => guard.check([{ path: join(link, "service.sock") }])).toThrow(/real device service/)
    expect(guard.takeViolations()).toHaveLength(1)
  })

  test("#given this process's preload #when Bun.connect or fetch's unix option names the machine's own socket #then each is refused before connecting", () => {
    const socket = join(guardedStateDir, "service.sock")

    expect(() => Bun.connect({ unix: socket, socket: { data() {} } })).toThrow(/real device service/)
    expect(() => fetch("http://localhost/", { unix: socket })).toThrow(/real device service/)
    expect(deviceServiceGuard.takeViolations()).toHaveLength(2)
  })
})

describe("device-service test guard", () => {
  test("#given this process's preload #when a test dials the machine's own service socket #then the connect throws and the violation is recorded", () => {
    expect(() => createConnection({ path: join(guardedStateDir, "service.sock") })).toThrow(/real device service/)
    expect(deviceServiceGuard.takeViolations()).toHaveLength(1)
  })

  test.each([
    ["a socket path in the guarded dir", (dir: string) => [join(dir, "service.sock")], true],
    ["socket options naming the guarded dir", (dir: string) => [{ path: join(dir, "service.sock") }], true],
    ["the guarded service's loopback port", (_: string) => [{ port: 41_234, host: "127.0.0.1" }], true],
    ["a fake's socket under tmpdir", (_: string) => [{ path: join(tmpdir(), "omo-fake", "service.sock") }], false],
    ["another loopback port", (_: string) => [{ port: 41_235, host: "127.0.0.1" }], false],
  ] as const)("#given %s #when checked #then it is refused only if it is the guarded service", (_, args, refused) => {
    const dir = realDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "endpoint.json"), JSON.stringify({ port: 41_234 }))
    const guard = createDeviceServiceGuard(dir)

    const check = () => guard.check(args(dir))

    if (refused) expect(check).toThrow(/real device service/)
    else expect(check).not.toThrow()
    expect(guard.takeViolations()).toHaveLength(refused ? 1 : 0)
  })
})
