import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { cleanupProjects, seedRecord, tempStore } from "../lifecycle/__fixtures__/lifecycle-fakes"
import type { TaskRecordStore } from "../store"
import { controlFor, fakeOwner, want } from "./__fixtures__/owner-fakes"
import { ControlInbox } from "./control-inbox"
import { writeControlFile } from "./control-fs"
import { controlDir, parseControlFileName } from "./control-paths"
import { readAckFile, writeRegister } from "./control-store"

const unregisters: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const unregister of unregisters.splice(0)) await unregister()
  cleanupProjects()
})

const HOST = 7501
const T1 = "st_00000001"
const MALFORMED = ["want-not_a_task-0123456789abcdef.json", "want-..-0123456789abcdef.json", "ack-st_zz-0123456789abcdef.json"]

function recordingLoads(store: TaskRecordStore): { readonly store: TaskRecordStore; readonly loaded: string[] } {
  const loaded: string[] = []
  const proxy = new Proxy(store, {
    get(target, key) {
      if (key === "load") return (taskId: string) => { loaded.push(taskId); return target.load(taskId) }
      const value: unknown = Reflect.get(target, key)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  return { store: proxy, loaded }
}

function setup(now: () => number) {
  const base = tempStore()
  seedRecord(base, { task_id: T1, status: "running", run_epoch: 1, host_pid: HOST })
  const { store, loaded } = recordingLoads(base)
  const owner = fakeOwner(base, HOST)
  owner.live.add(T1)
  const inbox = ControlInbox.for({ stateDir: base.stateDir, hostPid: HOST, store, autoStart: false, now })
  unregisters.push(inbox.register(owner, { channel: true, liveTasks: () => owner.live.size }))
  const dir = controlDir(base.stateDir)
  for (const name of MALFORMED) writeControlFile(dir, name, "", controlFor(base).env)
  writeRegister(base, controlFor(base), want())
  return { base, owner, inbox, loaded, dir }
}

describe("a control file name whose task id is not the store's grammar (review of #12371 r2, MEDIUM)", () => {
  test("#given names shaped like a control file with a malformed or traversal-shaped task id #when parsed #then the typed refusal", () => {
    for (const name of MALFORMED) expect(parseControlFileName(name)).toEqual({ kind: "invalid_task_id" })
    expect(parseControlFileName("want-st_00000001-0123456789abcdef.json")).toMatchObject({ kind: "want", taskId: T1 })
  })

  test("#given malformed names beside a valid own register #when the owner ticks #then the register is applied and the store never sees a malformed id", async () => {
    const { base, owner, inbox, loaded } = setup(() => 1_000_000)
    await inbox.tick()
    expect(owner.calls.pause).toBe(1)
    expect(readAckFile(controlFor(base), T1, "parent-1")).toMatchObject({ state: "held" })
    expect(loaded.filter(taskId => !/^st_[0-9a-f]{8}$/.test(taskId))).toEqual([])
  })

  test("#given malformed names older than a day #when the inbox sweeps #then they are removed without a store read", async () => {
    let now = 1_000_000
    const { inbox, loaded, dir } = setup(() => now)
    const old = new Date(0)
    for (const name of MALFORMED) utimesSync(join(dir, name), old, old)
    now = 2 * 24 * 60 * 60 * 1000
    await inbox.tick()
    for (const name of MALFORMED) expect(existsSync(join(dir, name))).toBe(false)
    expect(loaded.filter(taskId => !/^st_[0-9a-f]{8}$/.test(taskId))).toEqual([])
  })
})
