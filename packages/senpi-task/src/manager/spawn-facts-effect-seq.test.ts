import { afterEach, expect, test } from "bun:test"

import type { TaskRecordStore } from "../store/types"
import type { ManagedChildHandle } from "./child-handle"
import type { ManagedStartSpec } from "./types"
import { baseSpec, cleanupProjects, FakeRunner, launchSettled, makeManager } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

// #10708: the manager stamps a daemon child's spawn facts (pid, host session, effective model) onto the task
// record while sends may already be minting input ids into that record (runners/input-effects.ts). A send that
// mints between the stamp's read and its write must survive: the durable input identity never goes backwards.
class SendDuringStampRunner extends FakeRunner {
  store: TaskRecordStore | undefined
  minted = 0

  override async start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const handle = await super.start(spec)
    return Object.assign(handle, {
      kind: "host-session" as const,
      hostSession: { socket: "/tmp/fake-host/rpc.sock", routingId: "routing-1", sessionPath: `/tmp/fake-host/${spec.taskId}.jsonl`, instanceId: "instance-1" },
      // The manager reads the child's effective model while it stamps the spawn facts: a send lands right then,
      // minting its id the way input-effects.ts does.
      effectiveModel: () => {
        this.store?.mutate(spec.taskId, record => {
          const seq = Math.max(record.effect_seq ?? 0, record.host_session?.effect_seq ?? 0) + 1
          this.minted = seq
          return { ...record, effect_seq: seq,
            ...(record.host_session === undefined ? {} : { host_session: { ...record.host_session, effect_seq: seq } }) }
        })
        return undefined
      },
    })
  }
}

test("#given a send minting an input id while the manager stamps a daemon child's spawn facts #when the stamp lands #then the minted effect_seq is kept on the record and its host session", async () => {
  const runner = new SendDuringStampRunner()
  const { manager, store } = makeManager({ inProcess: runner, process: runner })
  runner.store = store

  const started = await manager.start(baseSpec())
  if (started.kind !== "started") throw new Error(`launch failed: ${started.kind}`)
  await launchSettled(manager, started)

  const record = store.load(started.task_id)
  expect(runner.minted).toBeGreaterThan(0)
  expect(record?.effect_seq).toBe(runner.minted)
  expect(record?.host_session?.effect_seq).toBe(runner.minted)
})
