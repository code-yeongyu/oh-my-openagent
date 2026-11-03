import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { createInputEffects, InputUncertainError, InputConflictError } from "./input-effects"
import { RpcRequestTimeout } from "./rpc/errors"
import { mapSendOutcome } from "../tools/control/send-results"

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "t12-effects-"))
  dirs.push(dir)
  const store = createTaskRecordStore({ project_dir: dir })
  const record = createTaskRecord({
    parent_session_id: "parent", root_session_id: "parent", depth: 1,
    execution_mode: "process", model: "test/model", notify_on_terminal: false,
  })
  store.save(record)
  store.transition(record.task_id, { type: "start", timestamp: new Date().toISOString() })
  return { dir, store, taskId: record.task_id }
}

test("#given a durable record #when inputs and a reloaded sender send #then ids are persisted before writes and never reused", async () => {
  const { dir, store, taskId } = fixture()
  const ids: string[] = []
  const send = async (command: { clientMessageId: string }) => {
    const fresh = createTaskRecordStore({ project_dir: dir }).load(taskId)
    const seq = Number(command.clientMessageId.split(":").at(-1))
    expect(fresh?.effect_seq).toBe(seq)
    ids.push(command.clientMessageId)
  }
  await createInputEffects({ taskId, store, send }).send({ type: "prompt", message: "initial" })
  await createInputEffects({ taskId, store: createTaskRecordStore({ project_dir: dir }), send })
    .send({ type: "steer", message: "second" })
  expect(ids).toEqual([`${taskId}:0:1`, `${taskId}:0:2`])
})

test("#given an acknowledgement timeout #when one background retry succeeds #then uncertainty resolves with the same id and payload", async () => {
  const { store, taskId } = fixture()
  const events: Array<{ type: string; payload: unknown }> = []
  const resolved = Promise.withResolvers<void>()
  const append = store.appendEvent
  const observedStore = { ...store, appendEvent: (id: string, event: { type: string; payload: unknown }) => {
    events.push(event)
    const path = append(id, event)
    if (event.type === "steered") resolved.resolve()
    return path
  } }
  const commands: unknown[] = []
  const effects = createInputEffects({ taskId, store: observedStore, send: async command => {
    commands.push(command)
    if (commands.length === 1) throw new RpcRequestTimeout("steer", 30_000)
  } })
  const error = await effects.send({ type: "steer", message: "once" }).catch(e => e)
  expect(error).toBeInstanceOf(InputUncertainError)
  const rendered = mapSendOutcome({ kind: "uncertain", task_id: taskId, effect_id: error.effectId, reason: error.message })
  expect(rendered.isError).not.toBe(true)
  expect(rendered.content[0]).toMatchObject({ type: "text" })
  expect(error.message).toContain("do not resend")
  await bounded(resolved.promise)
  expect(commands).toHaveLength(2)
  expect(commands[1]).toEqual(commands[0])
  expect(events.map(event => event.type)).toEqual(["effect_uncertain", "steered"])
  expect(store.load(taskId)?.uncertain_inputs).toBeUndefined()
})

test("#given a timed-out id rebound to different text #when retry conflicts #then failure has an action and no delivery event", async () => {
  const { store, taskId } = fixture()
  const events: string[] = []
  const failed = Promise.withResolvers<void>()
  const append = store.appendEvent
  const observedStore = { ...store, appendEvent: (id: string, event: { type: string; payload: unknown }) => {
    events.push(event.type)
    const path = append(id, event)
    if (event.type === "effect_failed") failed.resolve()
    return path
  } }
  let calls = 0
  const effects = createInputEffects({ taskId, store: observedStore, send: async () => {
    if (++calls === 1) throw new RpcRequestTimeout("steer", 30_000)
    throw new Error("client_message_id_conflict: different fingerprint")
  } })
  await expect(effects.send({ type: "steer", message: "once" })).rejects.toBeInstanceOf(InputUncertainError)
  await bounded(failed.promise)
  expect(events).toEqual(["effect_uncertain", "effect_failed"])
  expect(store.load(taskId)?.uncertain_inputs).toBeUndefined()
  const conflict = new InputConflictError("input")
  const rendered = mapSendOutcome({ kind: "failed", task_id: taskId, effect_id: "input",
    reason: conflict.reason, detail: conflict.detail, action: conflict.action })
  expect(rendered.isError).toBe(true)
  expect(conflict.action).toBe("send the message again")
})

test("#given two timeouts #when a reloaded sender reconciles #then the pending payload keeps its original identity", async () => {
  const { dir, store, taskId } = fixture()
  const retry = Promise.withResolvers<void>()
  const commands: Array<{ clientMessageId: string }> = []
  const effects = createInputEffects({ taskId, store, send: async command => {
    commands.push(command)
    if (commands.length === 2) retry.resolve()
    throw new RpcRequestTimeout("steer", 30_000)
  } })
  await expect(effects.send({ type: "steer", message: "once" })).rejects.toBeInstanceOf(InputUncertainError)
  await bounded(retry.promise)
  expect(store.load(taskId)?.uncertain_inputs).toHaveLength(1)
  await createInputEffects({ taskId, store: createTaskRecordStore({ project_dir: dir }), send: async command => {
    commands.push(command)
  } }).reconcile()
  expect(commands).toHaveLength(3)
  expect(commands[2]).toEqual(commands[0])
})

test("#given an unacknowledged input #when the cause is the request deadline or a lost connection #then the uncertain reason names that cause", async () => {
  const { store, taskId } = fixture()
  const gone = Object.assign(new Error("transport gone"), { name: "RpcTransportGoneError" })
  const causes: Error[] = [new RpcRequestTimeout("steer", 45_000), gone]
  const effects = createInputEffects({ taskId, store, send: async () => { throw causes.shift() ?? new Error("unexpected") } })
  effects.stopRetrying()
  const timedOut = await effects.send({ type: "steer", message: "a" }).catch(e => e)
  const lost = await effects.send({ type: "steer", message: "b" }).catch(e => e)
  expect(timedOut).toBeInstanceOf(InputUncertainError)
  expect(timedOut.message).toContain("45 s")
  expect(lost).toBeInstanceOf(InputUncertainError)
  expect(lost.message).toContain("connection to the host was lost")
  expect(lost.message).not.toContain("45 s")
})

test("#given an input left uncertain by an earlier run #when a later run reconciles #then it is not delivered into the new run and the record forgets it", async () => {
  const { dir, store, taskId } = fixture()
  const effects = createInputEffects({ taskId, store, send: async () => { throw new RpcRequestTimeout("prompt", 30_000) } })
  effects.stopRetrying()
  await expect(effects.send({ type: "prompt", message: "old run" })).rejects.toBeInstanceOf(InputUncertainError)
  expect(store.load(taskId)?.uncertain_inputs).toHaveLength(1)
  store.mutate(taskId, record => ({ ...record, notification: { ...record.notification, run_epoch: record.notification.run_epoch + 1 } }))
  const sent: unknown[] = []
  const events: string[] = []
  const reloaded = createTaskRecordStore({ project_dir: dir })
  const append = reloaded.appendEvent
  await createInputEffects({ taskId, store: { ...reloaded, appendEvent: (id: string, event: { type: string; payload: unknown }) => {
    events.push(`${event.type}:${String((event.payload as { reason?: string }).reason)}`)
    return append(id, event)
  } }, send: async command => { sent.push(command) } }).reconcile()
  expect(sent).toEqual([])
  expect(events).toEqual(["effect_failed:superseded_by_new_run"])
  expect(store.load(taskId)?.uncertain_inputs).toBeUndefined()
})

test("#given an earlier-run input whose retry is still in flight #when a later run reconciles #then only that retry settles it and the log never records it both ways", async () => {
  const { store, taskId } = fixture()
  const inFlight = Promise.withResolvers<void>()
  const retryStarted = Promise.withResolvers<void>()
  const events: string[] = []
  const append = store.appendEvent
  const observed = { ...store, appendEvent: (id: string, event: { type: string; payload: unknown }) => {
    events.push(event.type)
    return append(id, event)
  } }
  let calls = 0
  const effects = createInputEffects({ taskId, store: observed, send: async () => {
    if (++calls === 1) throw new RpcRequestTimeout("steer", 30_000)
    retryStarted.resolve()
    await inFlight.promise
  } })
  await expect(effects.send({ type: "steer", message: "once" })).rejects.toBeInstanceOf(InputUncertainError)
  await bounded(retryStarted.promise)
  store.mutate(taskId, record => ({ ...record, notification: { ...record.notification, run_epoch: record.notification.run_epoch + 1 } }))
  const reconciled = effects.reconcile()
  inFlight.resolve()
  await bounded(reconciled)
  expect(events).toEqual(["effect_uncertain", "steered"])
})

// #2838 step 4: a queued steer keeps its own id across the child boundary, and a lost acknowledgment is
// resolved by reading that id from the child before anything is sent again.
function observedEvents(store: ReturnType<typeof createTaskRecordStore>, until?: string) {
  const events: string[] = []
  const reached = Promise.withResolvers<void>()
  const append = store.appendEvent
  return {
    events,
    reached: reached.promise,
    store: { ...store, appendEvent: (id: string, event: { type: string; payload: unknown }) => {
      events.push(event.type)
      const path = append(id, event)
      if (event.type === until) reached.resolve()
      return path
    } },
  }
}

test("#given a caller's own id #when the input is sent #then it goes out under that id and no id is minted", async () => {
  const { store, taskId } = fixture()
  const sent: unknown[] = []
  await createInputEffects({ taskId, store, send: async command => { sent.push(command) } })
    .send({ type: "steer", message: "queued", clientMessageId: "ps-1-entry" })
  expect(sent).toEqual([{ type: "steer", message: "queued", clientMessageId: "ps-1-entry" }])
  expect(store.load(taskId)?.last_effect_id).toBe("ps-1-entry")
  expect(store.load(taskId)?.effect_seq).toBeUndefined()
})

test("#given a lost acknowledgment the child admitted #when it is resolved #then the read settles it and nothing is sent again", async () => {
  const { store, taskId } = fixture()
  const observed = observedEvents(store, "steered")
  const sent: unknown[] = []
  const reads: Array<readonly string[]> = []
  const effects = createInputEffects({
    taskId, store: observed.store,
    send: async command => { sent.push(command); throw new RpcRequestTimeout("steer", 30_000) },
    read: async ids => { reads.push(ids); return new Map(ids.map(id => [id, "admitted" as const])) },
  })
  await expect(effects.send({ type: "steer", message: "once", clientMessageId: "ps-1-entry" })).rejects.toBeInstanceOf(InputUncertainError)
  await bounded(observed.reached)
  expect(sent).toHaveLength(1)
  expect(reads).toEqual([["ps-1-entry"]])
  expect(observed.events).toEqual(["effect_uncertain", "steered"])
  expect(store.load(taskId)?.uncertain_inputs).toBeUndefined()
})

test("#given a lost acknowledgment the child never admitted #when it is resolved #then it is sent again under the same id", async () => {
  const { store, taskId } = fixture()
  const observed = observedEvents(store, "steered")
  const sent: unknown[] = []
  const effects = createInputEffects({
    taskId, store: observed.store,
    send: async command => {
      sent.push(command)
      if (sent.length === 1) throw new RpcRequestTimeout("steer", 30_000)
    },
    read: async ids => new Map(ids.map(id => [id, "not_admitted" as const])),
  })
  await expect(effects.send({ type: "steer", message: "once", clientMessageId: "ps-1-entry" })).rejects.toBeInstanceOf(InputUncertainError)
  await bounded(observed.reached)
  expect(sent).toEqual([
    { type: "steer", message: "once", clientMessageId: "ps-1-entry" },
    { type: "steer", message: "once", clientMessageId: "ps-1-entry" },
  ])
})

test("#given a lost acknowledgment and a failed admission read #when it is resolved #then it stays uncertain and nothing is sent", async () => {
  const { store, taskId } = fixture()
  const read = Promise.withResolvers<void>()
  const sent: unknown[] = []
  const effects = createInputEffects({
    taskId, store,
    send: async command => { sent.push(command); throw new RpcRequestTimeout("steer", 30_000) },
    read: async () => { read.resolve(); throw new Error("host unreachable") },
  })
  await expect(effects.send({ type: "steer", message: "once", clientMessageId: "ps-1-entry" })).rejects.toBeInstanceOf(InputUncertainError)
  await bounded(read.promise)
  await bounded(effects.reconcile())
  expect(sent).toHaveLength(1)
  expect(store.load(taskId)?.uncertain_inputs?.map(input => input.clientMessageId)).toEqual(["ps-1-entry"])
})

test("#given an earlier run's input the child admitted #when a later run reconciles #then it is settled, not failed as superseded", async () => {
  const { dir, store, taskId } = fixture()
  const first = createInputEffects({ taskId, store, send: async () => { throw new RpcRequestTimeout("steer", 30_000) } })
  first.stopRetrying()
  await expect(first.send({ type: "steer", message: "old run", clientMessageId: "ps-1-entry" })).rejects.toBeInstanceOf(InputUncertainError)
  expect(store.load(taskId)?.uncertain_inputs?.[0]?.run_epoch).toBe(store.load(taskId)?.notification.run_epoch)
  store.mutate(taskId, record => ({ ...record, notification: { ...record.notification, run_epoch: record.notification.run_epoch + 1 } }))
  const observed = observedEvents(createTaskRecordStore({ project_dir: dir }))
  const sent: unknown[] = []
  await createInputEffects({
    taskId, store: observed.store, send: async command => { sent.push(command) },
    read: async ids => new Map(ids.map(id => [id, "admitted" as const])),
  }).reconcile()
  expect(sent).toEqual([])
  expect(observed.events).toEqual(["steered"])
  expect(store.load(taskId)?.uncertain_inputs).toBeUndefined()
})

test("#given an earlier run's input and a failed admission read #when a later run reconciles #then it stays uncertain, neither failed nor sent", async () => {
  const { dir, store, taskId } = fixture()
  const first = createInputEffects({ taskId, store, send: async () => { throw new RpcRequestTimeout("steer", 30_000) } })
  first.stopRetrying()
  await expect(first.send({ type: "steer", message: "old run", clientMessageId: "ps-1-entry" })).rejects.toBeInstanceOf(InputUncertainError)
  store.mutate(taskId, record => ({ ...record, notification: { ...record.notification, run_epoch: record.notification.run_epoch + 1 } }))
  const observed = observedEvents(createTaskRecordStore({ project_dir: dir }))
  const sent: unknown[] = []
  await createInputEffects({
    taskId, store: observed.store, send: async command => { sent.push(command) },
    read: async () => { throw new Error("host unreachable") },
  }).reconcile()
  expect(sent).toEqual([])
  expect(observed.events).toEqual([])
  expect(createTaskRecordStore({ project_dir: dir }).load(taskId)?.uncertain_inputs?.map(input => input.clientMessageId)).toEqual(["ps-1-entry"])
})

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("input resolution did not arrive")), 5_000)
    })])
  } finally { clearTimeout(timer) }
}
