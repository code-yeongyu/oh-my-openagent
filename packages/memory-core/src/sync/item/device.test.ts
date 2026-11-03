import { describe, expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { captureOnDevice, createDeviceItemDoc, DevicePeerError, openItemDevice, renderItem } from "./index"
import { newDoc } from "./test-support"

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "item-device-"))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe("openItemDevice", () => {
  test("#given a fresh state dir #when opened twice #then one peer is created, persisted and reused", async () => {
    await withDir(async (dir) => {
      const options = { stateDir: join(dir, "state"), memoryRoot: join(dir, "memory") }
      const first = await openItemDevice(options)
      const second = await openItemDevice(options)
      expect(second.peer).toBe(first.peer)
      expect(BigInt(first.peer) > 0n).toBe(true)
    })
  })

  test("#given 64 concurrent first opens #when they race #then all get one peer and no candidate is left", async () => {
    for (let round = 0; round < 20; round++) {
      await withDir(async (dir) => {
        const options = { stateDir: join(dir, "state"), memoryRoot: join(dir, "memory") }
        const devices = await Promise.all(Array.from({ length: 64 }, () => openItemDevice(options)))
        expect(new Set(devices.map((d) => d.peer)).size, `round ${round}`).toBe(1)
        expect(await readdir(join(dir, "state")), `round ${round}`).toEqual(["peer"])
      })
    }
  })

  test("#given a memory dir copied to a second machine #when that machine opens it #then it gets a NEW peer", async () => {
    await withDir(async (dir) => {
      const memoryA = join(dir, "a", "memory")
      await mkdir(memoryA, { recursive: true })
      await writeFile(join(memoryA, "note.md"), "---\ndescription: d\n---\nbody\n")
      const deviceA = await openItemDevice({ stateDir: join(dir, "a", "state"), memoryRoot: memoryA })
      const memoryB = join(dir, "b", "memory")
      await cp(memoryA, memoryB, { recursive: true })
      const deviceB = await openItemDevice({ stateDir: join(dir, "b", "state"), memoryRoot: memoryB })
      expect(deviceB.peer).not.toBe(deviceA.peer)
      expect(await readdir(memoryB)).toEqual(["note.md"])
    })
  })

  test("#given a state dir copied to another machine #when opened there #then a NEW peer is minted and the receipts are retired", async () => {
    await withDir(async (dir) => {
      const memoryRoot = join(dir, "memory")
      const original = await openItemDevice({ stateDir: join(dir, "a"), memoryRoot, machineId: "machine-a" })
      const doc = await createDeviceItemDoc(original)
      const update = await captureOnDevice(original, "note.md", doc, "", [], "hello\n")
      if (update !== null) doc.import(update)
      doc.free()
      await cp(join(dir, "a"), join(dir, "b"), { recursive: true })
      const copied = await openItemDevice({ stateDir: join(dir, "b"), memoryRoot, machineId: "machine-b" })
      expect(copied.peer).not.toBe(original.peer)
      expect((await readdir(join(dir, "b"))).filter((name) => name === "captures")).toEqual([])
      const again = await openItemDevice({ stateDir: join(dir, "b"), memoryRoot, machineId: "machine-b" })
      expect(again.peer).toBe(copied.peer)
    })
  })

  test("#given a state dir copied to another path on the same machine #when opened #then it gets a NEW peer, while a restore to the original path keeps its peer (review r5 M3)", async () => {
    await withDir(async (dir) => {
      const memoryRoot = join(dir, "memory")
      const original = await openItemDevice({ stateDir: join(dir, "a"), memoryRoot, machineId: "machine-a" })
      await cp(join(dir, "a"), join(dir, "profile-2"), { recursive: true })
      const sibling = await openItemDevice({ stateDir: join(dir, "profile-2"), memoryRoot, machineId: "machine-a" })
      expect(sibling.peer).not.toBe(original.peer)
      await cp(join(dir, "a"), join(dir, "backup"), { recursive: true })
      await rm(join(dir, "a"), { recursive: true, force: true })
      await cp(join(dir, "backup"), join(dir, "a"), { recursive: true })
      const restored = await openItemDevice({ stateDir: join(dir, "a"), memoryRoot, machineId: "machine-a" })
      expect(restored.peer).toBe(original.peer)
    })
  })

  test("#given a state dir inside the synced memory root #when opened #then it is refused", async () => {
    await withDir(async (dir) => {
      const memoryRoot = join(dir, "memory")
      await mkdir(memoryRoot, { recursive: true })
      for (const stateDir of [memoryRoot, join(memoryRoot, ".git", "omo-sync"), join(memoryRoot, "nested", "state")]) {
        await expect(openItemDevice({ stateDir, memoryRoot }), stateDir).rejects.toBeInstanceOf(DevicePeerError)
      }
      await expect(openItemDevice({ stateDir: join(dir, "memory-state"), memoryRoot })).resolves.toBeDefined()
    })
  })

  test("#given a corrupt peer id #when opened #then it throws instead of minting a second identity", async () => {
    await withDir(async (dir) => {
      const options = { stateDir: join(dir, "state"), memoryRoot: join(dir, "memory") }
      for (const bad of ["not-a-peer\n", `${(1n << 64n).toString()}\n`]) {
        await mkdir(join(dir, "state", "peer"), { recursive: true })
        await writeFile(join(dir, "state", "peer", "id"), bad)
        await expect(openItemDevice(options)).rejects.toBeInstanceOf(DevicePeerError)
      }
    })
  })
})

describe("device capture wiring", () => {
  test("#given a device doc #when captured through the entry point #then every op carries the device peer", async () => {
    await withDir(async (dir) => {
      const device = await openItemDevice({ stateDir: join(dir, "state"), memoryRoot: join(dir, "memory") })
      const doc = await createDeviceItemDoc(device)
      const update = await captureOnDevice(device, "note.md", doc, "", [], "hello\n")
      if (update !== null) doc.import(update)
      expect(renderItem(doc)).toBe("hello\n")
      expect([...doc.oplogVersion().toJSON().keys()]).toEqual([device.peer])
      doc.free()
    })
  })

  test("#given a doc that is not on the device peer #when captured #then the entry point refuses it", async () => {
    await withDir(async (dir) => {
      const device = await openItemDevice({ stateDir: join(dir, "state"), memoryRoot: join(dir, "memory") })
      const foreign = await newDoc("7")
      await expect(captureOnDevice(device, "note.md", foreign, "", [], "x\n")).rejects.toBeInstanceOf(DevicePeerError)
      foreign.free()
    })
  })
})
