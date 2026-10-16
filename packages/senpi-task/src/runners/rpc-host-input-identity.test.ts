import { afterEach, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { startHostWorld } from "./rpc-host/__fixtures__/host-world"
import { runTaskSend } from "../tools/control/send"
import { cleanupSteering, makeHarness } from "../steering/__fixtures__/steering-fakes"
import { adaptRpcHandle } from "../manager/child-handle"
import { childSpec, hostRunnerHarness } from "./rpc-host.test-support"
import { HostSessionClient } from "./rpc-host/session-client"
import { RpcRequestTimeout } from "./rpc/errors"

afterEach(cleanupSteering)

test("#given a daemon task #when it starts and receives two messages #then every parsed input carries the durable increasing identity", async () => {
  const world = await startHostWorld({ transcripts: true })
  const parent = world.connect("parent")
  try {
    await parent.startChildren(1)
    const record = parent.records()[0]
    if (record === undefined) throw new Error("task did not start")
    await runTaskSend(parent.manager, { to: record.task_id, message: "first" }, "parent")
    await runTaskSend(parent.manager, { to: record.task_id, message: "second" }, "parent")
    const inputs = world.host.commands.filter(command => ["prompt", "steer", "follow_up"].includes(command.type))
    expect(inputs.map(command => command.payload.clientMessageId)).toEqual([
      `${record.task_id}:0:1`, `${record.task_id}:0:2`, `${record.task_id}:0:3`,
    ])
    expect(parent.store.load(record.task_id)?.host_session?.effect_seq).toBe(3)
  } finally {
    await world.cleanup()
  }
})

for (const conflict of [false, true]) {
  test(`#given a withheld steer ack #when the same-id retry ${conflict ? "conflicts" : "replays"} #then ${conflict ? "no delivery is reported" : "the host admits it once"}`, async () => {
    const hostHarness = hostRunnerHarness()
    const h = makeHarness()
    const record = h.seedRecord()
    h.store.transition(record.task_id, { type: "start", timestamp: new Date().toISOString() })
    const host = await hostHarness.fakeHost({ transcripts: true })
    let timedOut = false
    class DeadlineClient extends HostSessionClient {
      override async send(command: Parameters<HostSessionClient["send"]>[0]): Promise<void> {
        if (command.type !== "steer" || timedOut) return super.send(command)
        timedOut = true
        host.withholdReply("steer")
        const received = host.waitForCommand("steer")
        void super.send(command).catch(() => undefined)
        await bounded(received)
        throw new RpcRequestTimeout("steer", 30_000)
      }
    }
    const runner = hostHarness.runnerOver(host, {
      storeDir: h.store.stateDir,
      createClient: socketPath => new DeadlineClient({ socketPath, ports: { probeProtocolInfo: () => host.probeProtocolInfo() } }),
    })
    const handle = await runner.start(childSpec({ task_id: record.task_id, taskStoreDir: h.store.stateDir,
      state_dir: join(h.store.stateDir, "children", record.task_id) }))
    h.setLive(record.task_id, adaptRpcHandle(handle))
    try {
      const outcome = await h.engine.sendToTask({ idOrName: record.task_id, message: "once", deliverAs: "steer" })
      expect(outcome.kind).toBe("uncertain")
      const first = host.commands.find(command => command.type === "steer")
      if (first === undefined) throw new Error("steer never arrived")
      const session = host.sessions()[0]
      if (session === undefined) throw new Error("host session is missing")
      if (conflict) host.admissions.rebind(session.sessionPath, { ...first.payload, message: "different" })
      const second = host.waitForCommand("steer")
      host.allowReply("steer")
      await bounded(second)
      await handle.reconcileInputs?.()
      const sends = host.commands.filter(command => command.type === "steer")
      expect(sends).toHaveLength(2)
      expect(sends.map(command => ({ id: command.payload.clientMessageId, text: command.payload.message })))
        .toEqual([{ id: first.payload.clientMessageId, text: "once" }, { id: first.payload.clientMessageId, text: "once" }])
      expect(host.admissions.count()).toBe(2) // initial prompt plus one steer
      const events = readFileSync(join(h.store.stateDir, "logs", `${record.task_id}.jsonl`), "utf8")
        .trim().split("\n").map(line => JSON.parse(line) as { type: string; payload: Record<string, unknown> })
      expect(events.filter(event => event.type === "effect_uncertain")).toHaveLength(1)
      expect(events.filter(event => event.type === "steered")).toHaveLength(conflict ? 0 : 1)
      if (conflict) expect(events.find(event => event.type === "effect_failed")?.payload).toMatchObject({
        reason: "effect_id_conflict", action: "send the message again",
      })
      expect(h.store.load(record.task_id)?.uncertain_inputs).toBeUndefined()
    } finally {
      await handle.dispose()
      await hostHarness.release()
    }
  })
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("host input did not arrive")), 5_000)
  })]) } finally { clearTimeout(timer) }
}

