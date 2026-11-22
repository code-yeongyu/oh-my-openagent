import { afterAll, beforeAll, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { createSkillSourceCopyFilter } from "@oh-my-opencode/shared-skills/skill-source-filter"
import type { FleetPort, MachineRef, ThreadPort } from "./ports.ts"

// Package contract (#11373): the skills tree ships inside the signed desktop bundle, so running a bundled
// script must leave that tree byte-identical. This runs every helper from a shipped-style copy.
const skillRoot = join(import.meta.dir, "..", "..")
const workRoot = mkdtempSync(join(tmpdir(), "omo-relay-writes-"))
const shippedRoot = join(workRoot, "omo-relay")

beforeAll(() => {
  cpSync(skillRoot, shippedRoot, { recursive: true, filter: createSkillSourceCopyFilter(skillRoot) })
})

afterAll(() => {
  rmSync(workRoot, { recursive: true, force: true })
})

function listTree(root: string): Map<string, string> {
  const entries = new Map<string, string>()
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else entries.set(relative(root, path), createHash("sha256").update(readFileSync(path)).digest("hex"))
    }
  }
  walk(root)
  return entries
}

const machine: MachineRef = { id: "id-a", alias: "device-a", state: "online" }
const fleet: FleetPort<MachineRef> = {
  listMachines: async () => [machine],
  fanout: (_targets, fn) =>
    (async function* () {
      yield {
        kind: "fulfilled" as const,
        machine,
        value: await fn(machine, { signal: new AbortController().signal }),
        index: 0,
      }
    })(),
}
const threads: ThreadPort = {
  list: async () => ({ kind: "ok", threads: [{ thread: "t-1", name: "one" }] }),
  read: async (thread) => ({ kind: "ok", thread, items: [] }),
  send: async (thread) => ({ kind: "ok", thread }),
}

test("#given the shipped copy #when every helper runs from it #then the copy holds no test file and stays byte-identical", async () => {
  // given
  const before = listTree(shippedRoot)
  const relay: typeof import("./index.ts") = await import(join(shippedRoot, "scripts", "sdk", "index.ts"))

  // when
  await relay.onEveryMachine(fleet, async () => "ok")
  await relay.onMachines(fleet, ["device-a"], async () => "ok")
  await relay.onMachine(fleet, "device-a", async () => "ok")
  await relay.onEveryThread(threads, async (row) => threads.read(row.thread))
  await relay.onThreads(["t-1"], (thread) => threads.read(thread))
  await relay.sendToThreads(threads, ["t-1"], "status")
  await relay.readThreads(threads, ["t-1"])

  // then
  expect([...before.keys()].filter((path) => path.endsWith(".test.ts"))).toEqual([])
  expect(before.has(join("scripts", "sdk", "index.ts"))).toBe(true)
  expect(listTree(shippedRoot)).toEqual(before)
})
