import { afterEach, describe, expect, test } from "bun:test"
import { utimesSync } from "node:fs"
import { join } from "node:path"
import { cleanupProjects, seedRecord, tempStore } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { controlFor, fakeOwner, want } from "./__fixtures__/owner-fakes"
import { ControlInbox } from "./control-inbox"
import { writeControlFile } from "./control-fs"
import { controlDir, registerName } from "./control-paths"
import { parseRegister } from "./control-schema"
import { readAckFile, writeRegister } from "./control-store"

const unregisters: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const unregister of unregisters.splice(0)) await unregister()
  cleanupProjects()
})

const HOST = 7401
const OTHER = 7402
const id = (n: number) => `st_${String(n).padStart(8, "0")}`

function setup() {
  const store = tempStore()
  const owner = fakeOwner(store, HOST)
  const inbox = ControlInbox.for({ stateDir: store.stateDir, hostPid: HOST, store, autoStart: false, now: () => 1_000_000 })
  unregisters.push(inbox.register(owner, { channel: true, liveTasks: () => owner.live.size }))
  return { store, owner, inbox }
}

function plant(store: ReturnType<typeof tempStore>, taskId: string, hostPid: number, ageSeconds: number): void {
  seedRecord(store, { task_id: taskId, status: "running", run_epoch: 1, host_pid: hostPid, parent_session_id: "parent-1" })
  writeRegister(store, controlFor(store), want({ taskId, runRef: { kind: "task", id: taskId } }))
  const at = new Date(1_000_000_000 - ageSeconds * 1000)
  utimesSync(join(controlDir(store.stateDir), registerName(taskId, "parent-1")), at, at)
}

describe("the inbox filters before it caps (review of #12371, MEDIUM)", () => {
  test("#given 65 older registers addressed to another live host #when this owner ticks #then its own fresh register is still applied", async () => {
    const { store, owner, inbox } = setup()
    for (let n = 1; n <= 65; n += 1) plant(store, id(n), OTHER, 1_000 - n)
    plant(store, id(99), HOST, 1)
    owner.live.add(id(99))
    await inbox.tick()
    expect(owner.calls.pause).toBe(1)
    expect(readAckFile(controlFor(store), id(99), "parent-1")).toMatchObject({ state: "held" })
  })

  test("#given 70 registers for this owner's own children #when it ticks twice #then all 70 are applied: answered ones never take a slot", async () => {
    const { store, owner, inbox } = setup()
    for (let n = 1; n <= 70; n += 1) {
      plant(store, id(n), HOST, 1_000 - n)
      owner.live.add(id(n))
    }
    await inbox.tick()
    expect(owner.calls.pause).toBe(64)
    await inbox.tick()
    expect(owner.calls.pause).toBe(70)
  })
})

describe("a planted register is refused (review of #12371, LOW)", () => {
  test("#given a register carrying an unknown key #when parsed #then it is refused", () => {
    expect(parseRegister(JSON.stringify(want()))).toBeDefined()
    expect(parseRegister(JSON.stringify({ ...want(), extra: true }))).toBeUndefined()
  })

  test.each([["missing", undefined], ["a number", 7]])("#given guidance whose text is %s #when parsed #then it is refused, never coerced", (_label, text) => {
    expect(parseRegister(JSON.stringify(want({ guidance: [{ inputId: "send-1", revision: 0, text: text as unknown as string }] })))).toBeUndefined()
  })

  test("#given a register whose content names another task than its file name #when the owner ticks #then nothing is acted on", async () => {
    const { store, owner, inbox } = setup()
    seedRecord(store, { task_id: id(1), status: "running", run_epoch: 1, host_pid: HOST })
    seedRecord(store, { task_id: id(2), status: "running", run_epoch: 1, host_pid: HOST })
    owner.live.add(id(1))
    owner.live.add(id(2))
    writeControlFile(controlDir(store.stateDir), registerName(id(1), "parent-1"),
      JSON.stringify(want({ taskId: id(2), runRef: { kind: "task", id: id(2) } })), controlFor(store).env)
    await inbox.tick()
    expect(owner.calls.pause).toBe(0)
  })
})
