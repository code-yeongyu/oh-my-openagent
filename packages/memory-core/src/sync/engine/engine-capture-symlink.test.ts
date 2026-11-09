import { mkdir, symlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { afterEach, expect, test } from "bun:test"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import { sealedItems } from "./received-keys.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

test("capture sends nothing reached through a symlink and reports it every cycle without counting it as rejected", async () => {
  const server = new FakeSyncServer()
  const lines: string[] = []
  const a = await makeDevice(server, "a", undefined, { log: (line) => lines.push(line) })
  devices.push(a)
  const outside = join(dirname(a.repo.root), "outside")
  await mkdir(outside)
  await writeFile(join(outside, "s.md"), "outside\n")
  await a.write("real/x.md", "one\n")
  await symlink(outside, join(a.repo.root, "linked"), "dir")
  await symlink("real", join(a.repo.root, "alias"), "dir")
  await symlink("missing-dir", join(a.repo.root, "gone"), "dir")
  await symlink("real/x.md", join(a.repo.root, "x-link.md"))

  expect(await a.engine.runCycle()).toMatchObject({ pushed: true })
  expect(sealedItems(server, 1).map((i) => i.key)).toEqual(["real/x.md"])
  await a.write("real/x.md", "two\n")
  await writeFile(join(outside, "s.md"), "outside edited\n")
  expect(await a.engine.runCycle()).toMatchObject({ pushed: true })
  expect(sealedItems(server, 2).map((i) => i.key)).toEqual(["real/x.md"])

  expect(await a.engine.state()).toMatchObject({ rejectedItems: 0, cycle: null, paused: null })
  expect(lines.filter((line) => line.startsWith("sync.item.rejected") && line.endsWith("rule=symlink"))).toHaveLength(8)
  const b = await makeDevice(server, "b")
  devices.push(b)
  expect(await b.engine.runCycle()).toMatchObject({ rejectedItems: 0 })
  expect(await b.workingFiles()).toEqual([".gitkeep", "real/x.md"])
  expect(await b.read("real/x.md")).toBe("two\n")
}, GIT_TEST_TIMEOUT)
