import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync } from "node:fs"
import { cleanupProjects, seedRecord, tempStore } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { fakeOwner } from "./__fixtures__/owner-fakes"
import { ControlInbox } from "./control-inbox"
import { controlDir } from "./control-paths"
import { createRequesterChannel } from "./requester-channel"

const unregisters: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const unregister of unregisters.splice(0)) await unregister()
  cleanupProjects()
})

const PID = 9301

function sameProcess(input: { readonly siblingHolds: boolean; readonly unsafeDir?: boolean }) {
  const store = tempStore()
  const record = seedRecord(store, { task_id: "st_00000001", status: "running", run_epoch: 1, host_pid: PID })
  const sibling = fakeOwner(store, PID)
  if (input.siblingHolds) sibling.live.add(record.task_id)
  const inbox = ControlInbox.for({ stateDir: store.stateDir, hostPid: PID, store, autoStart: false })
  unregisters.push(inbox.register(sibling, { channel: true, liveTasks: () => sibling.live.size }))
  if (input.unsafeDir === true) {
    mkdirSync(controlDir(store.stateDir), { mode: 0o700 })
    chmodSync(controlDir(store.stateDir), 0o777)
  }
  const channel = createRequesterChannel({ stateDir: store.stateDir, store, hostPid: PID, managerInstance: "requester-a",
    channel: true, isProcessAlive: () => true })
  return { channel, record }
}

describe("ownership predicate, same process (design 3.2 case b)", () => {
  test("#given a sibling manager of this process holds the handle #when asked #then the child is owned elsewhere (test 7)", () => {
    const { channel, record } = sameProcess({ siblingHolds: true })
    expect(channel.ownedElsewhere(record)).toBe(true)
  })

  test("#given no sibling holds it #when asked #then the child is this process's own (test 7, F15)", () => {
    const { channel, record } = sameProcess({ siblingHolds: false })
    expect(channel.ownedElsewhere(record)).toBe(false)
  })

  test.if(process.platform !== "win32")("#given the control dir is unsafe #when a sibling holds the handle #then it is still owned elsewhere: the answer never reads a file (test 20e)", () => {
    const { channel, record } = sameProcess({ siblingHolds: true, unsafeDir: true })
    expect(channel.ownedElsewhere(record)).toBe(true)
    expect(channel.cannotApply(record)).toBe("owner_unsupported")
  })
})
