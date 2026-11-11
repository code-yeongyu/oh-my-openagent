import { afterEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { UpdateStore, generationId, type Generation } from "../update-store"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "omo-update-store-")))
  roots.push(root)
  const launcher = join(root, "bin", "omo")
  await mkdir(join(root, "bin"))
  await writeFile(launcher, "bootstrap")
  const store = new UpdateStore(join(root, "updates"), launcher)
  return { root, store, launcher }
}

async function payload(store: UpdateStore, version: string): Promise<{ generation: Generation; staging: string }> {
  const digest = createHash("sha256").update(`payload ${version}`).digest("hex")
  const generation: Generation = { version, asset: "omo-linux-x64", digest, protocol: 1, backwardCompatible: true }
  const staging = await store.createStaging()
  await writeFile(join(staging, "omo"), `payload ${version}`, { mode: 0o755 })
  await writeFile(join(staging, "plugin.txt"), `plugin ${version}`)
  return { generation, staging }
}

async function seed(store: UpdateStore) {
  const first = await payload(store, "1.0.0")
  await store.transaction(async (tx) => {
    await tx.initialize({ asset: first.generation.asset, channel: "stable", ownership: "standalone" })
    await tx.publish(first.staging, first.generation)
    await tx.select(async () => {})
  })
  return first.generation
}

test("publication and selection never rewrite a leased old generation", async () => {
  const { store } = await fixture()
  const first = await seed(store)
  const lease = await store.lease(generationId(first))
  const second = await payload(store, "2.0.0")
  await store.transaction(async (tx) => {
    await tx.publish(second.staging, second.generation)
    expect((await store.read())?.selected).toBe(generationId(first))
    await tx.select(async (directory) => {
      expect(await readFile(join(directory, "plugin.txt"), "utf8")).toBe("plugin 2.0.0")
    })
  })
  const third = await payload(store, "3.0.0")
  await store.transaction(async (tx) => {
    await tx.publish(third.staging, third.generation)
    await tx.select(async () => {})
    await tx.gc()
  })
  const fourth = await payload(store, "4.0.0")
  await store.transaction(async (tx) => {
    await tx.publish(fourth.staging, fourth.generation)
    await tx.select(async () => {})
    await tx.gc()
  })
  expect(await readFile(join(lease.directory, "omo"), "utf8")).toBe("payload 1.0.0")
  await lease.release()
  await store.transaction((tx) => tx.gc())
  expect(await Bun.file(join(lease.directory, "omo")).exists()).toBe(false)
})

test("failed preflight quarantines a candidate and preserves the committed version", async () => {
  const { store } = await fixture()
  const first = await seed(store)
  const second = await payload(store, "2.0.0")
  await store.transaction(async (tx) => {
    await tx.publish(second.staging, second.generation)
    await expect(tx.select(async () => { throw new Error("engine did not start") })).rejects.toThrow("engine did not start")
  })
  const record = await store.read()
  expect(record?.selected).toBe(generationId(first))
  expect(record?.quarantine[generationId(second.generation)]).toContain("engine did not start")
})

test("a corrupted selected executable falls back before user work begins", async () => {
  const { store } = await fixture()
  const first = await seed(store)
  const second = await payload(store, "2.0.0")
  await store.transaction(async (tx) => {
    await tx.publish(second.staging, second.generation)
    await tx.select(async () => {})
  })
  await writeFile(join(store.generationPath(generationId(second.generation)), "omo"), "corrupted")
  const lease = await store.selectedLease()
  expect(lease?.id).toBe(generationId(first))
  await lease?.release()
})

test("launcher replacement invalidates the persisted installation identity", async () => {
  const { store, launcher } = await fixture()
  await seed(store)
  await writeFile(launcher, "a different bootstrap")
  expect(await store.matchesLauncher()).toBe(false)
  await expect(store.transaction((tx) => tx.record())).rejects.toThrow("Launcher identity changed")
})

test("bootstrap maintenance stays pending until every launcher lease exits", async () => {
  const { store, launcher } = await fixture()
  const first = await seed(store)
  const second = await payload(store, "2.0.0")
  second.generation.protocol = 2
  await store.transaction((tx) => tx.publish(second.staging, second.generation))
  const lease = await store.lease(generationId(first))
  await store.transaction(async (tx) => {
    expect(await tx.maintainBootstrap(async () => {}, -1)).toBe(false)
  })
  expect(await readFile(launcher, "utf8")).toBe("bootstrap")
  await lease.release()
  await store.transaction(async (tx) => {
    expect(await tx.maintainBootstrap(async () => {}, -1)).toBe(true)
  })
  expect(await readFile(launcher, "utf8")).toBe("payload 2.0.0")
  expect(await store.matchesLauncher()).toBe(true)
  expect((await store.read())?.selected).toBe(generationId(second.generation))
})

test("an uncertain owner cannot be evicted by age or a mismatched nonce", async () => {
  const { store } = await fixture()
  await seed(store)
  await store.transaction(async () => {
    const lock = JSON.parse(await readFile(store.lockPath, "utf8"))
    expect(typeof lock.nonce).toBe("string")
    expect(lock.process_start).not.toBe("unavailable")
    const contender = new UpdateStore(store.root, store.launcher)
    await expect(contender.transaction(async () => { throw new Error("stolen") })).rejects.toThrow("Lock is held")
  })
})

const childFixture = join(import.meta.dir, "update-store-worker.ts")
async function child(root: string, launcher: string, action: string, crash = "") {
  const process = Bun.spawn([globalThis.process.execPath, childFixture, root, launcher, action, crash], {
    env: globalThis.process.env, stdout: "pipe", stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
  return { code, stdout, stderr }
}

test("two launchers, an updater and GC observe only complete committed generations", async () => {
  const { store, launcher } = await fixture()
  await seed(store)
  const results = await Promise.all(["launch", "launch", "update", "gc"].map((action) => child(store.root, launcher, action)))
  for (const result of results) {
    expect(result.stderr).toBe("")
    expect(result.code).toBe(0)
  }
  expect((await store.read())?.selected).toContain("2.0.0")
})

for (const boundary of ["journal-publish", "generation-published", "journal-select", "selection-committed",
  "journal-bootstrap", "bootstrap-replaced", "bootstrap-committed"]) {
  test(`SIGKILL at ${boundary} recovers a complete old or new record`, async () => {
    const { store, launcher } = await fixture()
    await seed(store)
    const result = await child(store.root, launcher, boundary.includes("bootstrap") ? "bootstrap" : "update", boundary)
    expect(result.code).not.toBe(0)
    expect(result.stdout).toContain(boundary)
    await store.transaction(async (tx) => {
      await tx.recover()
      const record = await store.read()
      expect(record?.selected).toBeDefined()
      const lease = await store.lease(record!.selected!)
      expect(await readFile(join(lease.directory, "omo"), "utf8")).toMatch(/^payload [12]\.0\.0$/)
      await lease.release()
    })
  })
}
