import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { cleanupProjects, seedRecord, tempStore } from "../../../../senpi-task/src/lifecycle/__fixtures__/lifecycle-fakes"
import { controlFor, fakeOwner, want } from "../../../../senpi-task/src/control/__fixtures__/owner-fakes"
import { ControlInbox } from "../../../../senpi-task/src/control/control-inbox"
import { ownersDir } from "../../../../senpi-task/src/control/control-paths"
import { readAckFile, writeRegister } from "../../../../senpi-task/src/control/control-store"
import type { TaskManager } from "../../../../senpi-task/src/manager/types"
import type { TaskPauseMethods } from "../../../../senpi-task/src/manager/run-pause"
import type { TaskRecordStore } from "../../../../senpi-task/src/store"
import { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import { registerControlOwner, type ControlOwnerRegistration } from "./engine-control-owner"
import { createEngineRunPause } from "./engine-run-pause"

const registrations: ControlOwnerRegistration[] = []
afterEach(async () => {
  for (const registration of registrations.splice(0)) await registration.release()
  cleanupProjects()
})

const HOST = 7101

function managerOver(store: TaskRecordStore, instance: string) {
  const owner = fakeOwner(store, HOST)
  owner.live.add("st_00000001")
  const manager = {
    managerInstance: instance,
    holdsLiveHandle: (taskId: string) => owner.live.has(taskId),
    get: (taskId: string) => store.load(taskId) ?? undefined,
    list: () => store.list().records.map(record => ({ record })),
    residentTaskIds: () => [...owner.live],
    pauseTask: owner.pauseTask, holdTaskInput: owner.holdTaskInput, observeTaskHold: owner.observeTaskHold,
    resumePausedTask: owner.resumePausedTask, cancelTask: owner.cancelTask,
  } as unknown as TaskManager & TaskPauseMethods
  return { owner, manager }
}

function register(store: TaskRecordStore, instance: string, channel: boolean) {
  const { owner, manager } = managerOver(store, instance)
  const barrier = new AdmissionBarrier()
  const runPause = createEngineRunPause({ stateDir: store.stateDir, manager, barrier,
    runtime: { getPauseState: () => undefined, fenceRun: () => undefined } })
  const registration = registerControlOwner({ stateDir: store.stateDir, store, manager, barrier, runPause,
    sessionId: () => "parent-1", ownsRecord: record => record.parent_session_id === "parent-1", channel, hostPid: HOST })
  registrations.push(registration)
  return owner
}

describe("control owner wiring and the task.control_channel switch (design 3.3 kill switch, notes nit 5)", () => {
  test("#given the switch off #when a register lands #then no inbox answers it and no advertisement is written, yet the sibling registry still sees the handle", async () => {
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000001", status: "running", run_epoch: 1, host_pid: HOST })
    const owner = register(store, "owner-off", false)
    writeRegister(store, controlFor(store), want())
    await ControlInbox.for({ stateDir: store.stateDir, hostPid: HOST, store }).tick()
    expect(readAckFile(controlFor(store), "st_00000001", "parent-1")).toBeUndefined()
    expect(owner.calls.pause).toBe(0)
    expect(existsSync(ownersDir(store.stateDir))).toBe(false)
    expect(ControlInbox.heldBySibling(store.stateDir, HOST, "st_00000001", "another-manager")).toBe(true)
  })

  test("#given the switch on #when a register lands #then the owner pauses its child once, acks held and advertises itself", async () => {
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000001", status: "running", run_epoch: 1, host_pid: HOST })
    const owner = register(store, "owner-on", true)
    writeRegister(store, controlFor(store), want())
    await ControlInbox.for({ stateDir: store.stateDir, hostPid: HOST, store }).tick()
    expect(readAckFile(controlFor(store), "st_00000001", "parent-1")).toMatchObject({ state: "held", owner: { managerInstance: "owner-on" } })
    expect(owner.calls.pause).toBe(1)
    expect(existsSync(ownersDir(store.stateDir))).toBe(true)
  })

  test("#given a released registration #when the inbox ticks #then the handle is no longer claimed by anyone", async () => {
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000001", status: "running", run_epoch: 1, host_pid: HOST })
    register(store, "owner-gone", true)
    await registrations.splice(0)[0]?.release()
    expect(ControlInbox.heldBySibling(store.stateDir, HOST, "st_00000001", "another-manager")).toBe(false)
  })
})
