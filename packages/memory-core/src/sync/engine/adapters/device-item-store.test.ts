import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDeviceItemStore } from "./device-item-store"

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function device(name: string) {
  const base = await mkdtemp(join(tmpdir(), `omo-item-store-${name}-`))
  dirs.push(base)
  const open = () =>
    createDeviceItemStore({ stateDir: join(base, "device"), memoryRoot: join(base, "memory"), syncDir: join(base, "memory", ".git", "omo-sync"), machineId: `machine-${name}` })
  return { open }
}

const NOTE = "---\ndescription: groceries\n---\nmilk\n"

test("a captured edit applied on another device renders the same item there", async () => {
  const a = await (await device("a")).open()
  const b = await (await device("b")).open()
  await Promise.all([a.load(), b.load()])
  const ops = await a.capture("notes/list.md", NOTE)
  if (ops === null) throw new Error("no ops captured")
  await a.apply("notes/list.md", ops)
  await b.apply("notes/list.md", ops)
  expect(b.render("notes/list.md", null)).toBe(NOTE)
  expect(b.keys()).toEqual(["notes/list.md"])
  expect(a.peer()).not.toBe(b.peer())
})

test("the working text equal to the materialised baseline is no edit", async () => {
  const a = await (await device("a")).open()
  await a.load()
  const ops = await a.capture("x.md", NOTE)
  if (ops === null) throw new Error("no ops")
  await a.apply("x.md", ops)
  await a.markMaterialized("x.md", NOTE)
  expect(await a.capture("x.md", NOTE)).toBeNull()
})

test("CRDT state and baselines survive a restart through persist and load", async () => {
  const d = await device("a")
  const first = await d.open()
  await first.load()
  const ops = await first.capture("x.md", NOTE)
  if (ops === null) throw new Error("no ops")
  await first.apply("x.md", ops)
  await first.markMaterialized("x.md", NOTE)
  await first.persist()
  const again = await d.open()
  await again.load()
  expect(again.render("x.md", null)).toBe(NOTE)
  expect(await again.capture("x.md", NOTE)).toBeNull()
  expect(again.peer()).toBe(first.peer())
})

test("rendering keeps the disk file's own frontmatter style when the model is unchanged", async () => {
  const a = await (await device("a")).open()
  await a.load()
  const ops = await a.capture("x.md", NOTE)
  if (ops === null) throw new Error("no ops")
  await a.apply("x.md", ops)
  const styled = "---\ndescription: 'groceries'\n---\nmilk\n"
  expect(a.render("x.md", styled)).toBe(styled)
})

test("a deleted file captures as a delete, and the item renders as gone", async () => {
  const a = await (await device("a")).open()
  await a.load()
  const ops = await a.capture("x.md", NOTE)
  if (ops === null) throw new Error("no ops")
  await a.apply("x.md", ops)
  await a.markMaterialized("x.md", NOTE)
  const gone = await a.capture("x.md", null)
  if (gone === null) throw new Error("the delete captured nothing")
  await a.apply("x.md", gone)
  expect(a.render("x.md", NOTE)).toBeNull()
})

test("a remote item applied and persisted before it was ever materialised survives a restart", async () => {
  const src = await (await device("src")).open()
  await src.load()
  const ops = await src.capture("x.md", NOTE)
  if (ops === null) throw new Error("no ops")
  const d = await device("a")
  const first = await d.open()
  await first.load()
  // A crash after the verified batch is applied and persisted, but before the cycle reaches
  // committed (where markMaterialized runs): the item has CRDT state and no baseline yet.
  await first.apply("x.md", ops)
  await first.persist()
  const again = await d.open()
  await again.load()
  expect(again.keys()).toEqual(["x.md"])
  expect(again.render("x.md", null)).toBe(NOTE)
})
