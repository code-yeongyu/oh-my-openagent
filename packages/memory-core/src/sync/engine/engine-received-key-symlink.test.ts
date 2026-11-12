import { existsSync } from "node:fs"
import { lstat, symlink } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, expect, test } from "bun:test"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import { item, publish } from "./received-keys.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

async function receiver(server: FakeSyncServer): Promise<Device> {
  const b = await makeDevice(server, "b")
  devices.push(b)
  await b.engine.runCycle()
  return b
}

async function settlesAndKeepsApplying(server: FakeSyncServer, b: Device): Promise<void> {
  expect(await b.engine.state()).toMatchObject({ cycle: null, paused: null })
  expect(await b.renderJournals()).toEqual([])
  await publish(server, item("after.md", "after"))
  expect(await b.engine.runCycle()).toMatchObject({ applied: 1, rejectedItems: 0 })
  expect(await b.read("after.md")).toBe("after\n")
}

test(
  "a received key under a directory symlink that stays inside the memory root is dropped and the cycle completes",
  async () => {
    const server = new FakeSyncServer()
    const b = await receiver(server)
    await b.write("real/x.md", "mine\n")
    await b.engine.runCycle()
    await symlink("real", join(b.repo.root, "alias"), "dir")
    await publish(server, item("alias/x.md", "through the link"), item("ok.md", "ok"))
    expect(await b.engine.runCycle()).toMatchObject({ applied: 1, rejectedItems: 1 })
    expect(await b.read("real/x.md")).toBe("mine\n")
    expect(await b.read("ok.md")).toBe("ok\n")
    await settlesAndKeepsApplying(server, b)
  },
  GIT_TEST_TIMEOUT,
)

test(
  "a received key under a dangling directory symlink is dropped without creating anything",
  async () => {
    const server = new FakeSyncServer()
    const b = await receiver(server)
    await symlink("missing-dir", join(b.repo.root, "gone"), "dir")
    await publish(server, item("gone/x.md", "into nowhere"), item("ok.md", "ok"))
    expect(await b.engine.runCycle()).toMatchObject({ applied: 1, rejectedItems: 1 })
    expect(existsSync(join(b.repo.root, "missing-dir"))).toBe(false)
    expect((await lstat(join(b.repo.root, "gone"))).isSymbolicLink()).toBe(true)
    expect(await b.read("ok.md")).toBe("ok\n")
    await settlesAndKeepsApplying(server, b)
  },
  GIT_TEST_TIMEOUT,
)

test(
  "a received key that names a symlink on this device leaves the link and its target untouched",
  async () => {
    const server = new FakeSyncServer()
    const b = await receiver(server)
    await b.write("f.md", "mine\n")
    await b.engine.runCycle()
    await symlink("f.md", join(b.repo.root, "f-link.md"))
    await publish(server, item("f-link.md", "from a peer"), item("ok.md", "ok"))
    expect(await b.engine.runCycle()).toMatchObject({ applied: 1, rejectedItems: 1 })
    expect((await lstat(join(b.repo.root, "f-link.md"))).isSymbolicLink()).toBe(true)
    expect(await b.read("f.md")).toBe("mine\n")
    await settlesAndKeepsApplying(server, b)
  },
  GIT_TEST_TIMEOUT,
)
