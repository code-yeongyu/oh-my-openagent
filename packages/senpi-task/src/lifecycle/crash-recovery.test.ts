import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { adaptRpcHandle } from "../manager/child-handle"
import { cleanupProjects as cleanupManagers } from "../manager/__fixtures__/manager-fakes"
import { respawnManagedTask } from "../manager/manager-respawn"
import { createHostSessionHandle } from "../runners/rpc-host/handle"
import { fakeSessionPort } from "../runners/rpc-host/handle.test-support"
import { manualRecoveryClock } from "../runners/rpc-host/__fixtures__/manual-recovery-clock"
import type { RpcRunnerSpec } from "../runners/types"
import { createTaskLifecycle } from "./create"
import { bounded, liveParentFixture } from "./__fixtures__/live-parent-fakes"
import { cleanupProjects } from "./__fixtures__/lifecycle-fakes"

const fixtures: Array<{ dispose(): Promise<void> }> = []
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.dispose()
  cleanupProjects()
  cleanupManagers()
})

async function crashFixture(failRespawn = false, failContinuation = false, stallReattach = false) {
  const f = liveParentFixture("host-session")
  f.dispose()
  const original = fakeSessionPort()
  const replacement = fakeSessionPort()
  const clock = manualRecoveryClock()
  const armed = Promise.withResolvers<void>()
  const sessionPath = join(f.store.stateDir, "saved", "child.jsonl")
  mkdirSync(dirname(sessionPath), { recursive: true })
  writeFileSync(sessionPath, [
    JSON.stringify({ type: "session", id: "saved-child" }),
    JSON.stringify({ type: "message", message: { role: "user", content: "Finish investigating the saved findings" } }),
    JSON.stringify({ type: "message", message: { role: "toolResult", content: "findings already collected" } }),
  ].join("\n") + "\n")
  const identity = { routingId: "routing-original", sessionPath, instanceId: "generation-original" }
  // Build the real handle with the manager-assigned identity before the loss.
  const running: ReturnType<typeof createHostSessionHandle>[] = []
  f.runner.start = async (spec) => {
    const handle = createHostSessionHandle({
      client: original, session: identity, taskId: spec.taskId,
      heartbeatIntervalMs: 60_000, now: () => 0, closeGraceMs: 0, openDisposition: "attached",
      transportRecovery: {
        clock: {
          schedule: (ms, expire) => {
            const clear = clock.schedule(ms, expire)
            armed.resolve()
            return clear
          },
        },
      },
      reattach: failContinuation
        ? async () => ({
            client: fakeSessionPort(() => Promise.reject(Object.assign(new Error("transport closed during delivery"), { code: "rpc_transport_gone" }))),
            session: identity, attached: false,
          })
        : async () => stallReattach ? Promise.withResolvers<undefined>().promise : undefined,
    })
    running.push(handle)
    return adaptRpcHandle(handle)
  }
  const specs: RpcRunnerSpec[] = []
  const switched: string[] = []
  const launchRecords: Array<{ prompt: string | undefined; sessionPath: string | undefined }> = []
  const resumed: ReturnType<typeof createHostSessionHandle>[] = []
  f.state.closeRefused = false
  const lifecycle = createTaskLifecycle({
    ...f.deps,
    respawn: (record, path) => {
      launchRecords.push({
        prompt: record.spawn_spec !== undefined && "prompt" in record.spawn_spec ? record.spawn_spec.prompt : undefined,
        sessionPath: path,
      })
      return respawnManagedTask({
        beforeLaunch: () => undefined, record, sessionPath: path, stateDir: f.store.stateDir,
        runners: { "in-process": f.runner, process: f.runner },
        rpcRunner: {
          start: async (spec) => {
            specs.push(spec)
            if (failRespawn) throw new Error("supervisor pid 4242 shard deadbeef cannot reopen")
            replacement.switchSession = async (path) => { switched.push(path); return { cancelled: false } }
            const next = createHostSessionHandle({
              client: replacement,
              session: { ...identity, routingId: "routing-new", instanceId: "generation-new" },
              taskId: spec.task_id, heartbeatIntervalMs: 60_000, now: () => 0, closeGraceMs: 0,
              openDisposition: "reopened",
            })
            resumed.push(next)
            return next
          },
        },
      })
    },
  })
  const id = await f.start()
  f.store.mutate(id, (record) => ({
    ...record, description: "Investigate saved findings",
    host_session: { socket: original.socketPath, routing_id: identity.routingId, session_path: sessionPath, instance_id: identity.instanceId },
  }))
  const dispose = async () => {
    lifecycle.dispose?.()
    for (const handle of running) await handle.dispose()
    for (const next of resumed) await next.dispose()
  }
  fixtures.push({ dispose })
  return { ...f, lifecycle, id, original, specs, switched, replacement, launchRecords, sessionPath, clock, armed }
}

describe("host crash uses existing bounded child recovery (#10023)", () => {
  for (const failContinuation of [false, true]) {
    test(`failed ${failContinuation ? "continuation" : "reattach"} respawns from recorded launch and transcript without a notice`, async () => {
      const f = await crashFixture(false, failContinuation)
      const attempted = f.wait("live_parent_recovery_attempt")
      f.original.loseTransport()
      await attempted
      expect(f.specs).toHaveLength(1)
      expect(f.launchRecords).toEqual([{ prompt: "do the thing", sessionPath: f.sessionPath }])
      expect(f.specs[0]).toMatchObject({ cwd: f.store.load(f.id)?.spawn_spec?.cwd, prompt: "", resumeSessionPath: f.sessionPath })
      expect(f.switched).toEqual([f.sessionPath])
      // The continuation is an identified input (#10129): a durable id bound to this task.
      expect(f.replacement.sent).toEqual([{
        type: "prompt",
        streamingBehavior: "followUp",
        message: expect.any(String),
        clientMessageId: expect.stringMatching(new RegExp(`^${f.id}:\\d+:\\d+$`)),
      }])
      const continuation = f.replacement.sent[0]
      expect(continuation?.type === "prompt" ? continuation.message : undefined).not.toBe(f.launchRecords[0]?.prompt)
      expect(f.store.load(f.id)?.status).toBe("running")
      expect(f.manager.getResidentHandle(f.id)).toBeDefined()
      expect(f.terminals).toHaveLength(0)
      expect(f.messages).toHaveLength(0)
    })
  }

  test("an unresponsive reattach reaches contextual respawn when its fake-clock bound expires", async () => {
    const f = await crashFixture(false, false, true)
    const attempted = f.wait("live_parent_recovery_attempt")
    f.original.loseTransport()
    await bounded(f.armed.promise)
    expect(f.clock.pending()).toBe(1)
    f.clock.expire()
    await attempted
    expect(f.specs).toHaveLength(1)
    expect(f.specs[0]?.resumeSessionPath).toBe(f.sessionPath)
    expect(f.store.load(f.id)?.status).toBe("running")
    expect(f.messages).toHaveLength(0)
    expect(f.clock.pending()).toBe(0)
  })

  test("failed respawns stop at the persisted budget and deliver one plain reason and retry action", async () => {
    const f = await crashFixture(true)
    const attempted = f.wait("live_parent_recovery_attempt")
    f.original.loseTransport()
    await attempted
    expect(f.specs).toHaveLength(1)
    expect(f.messages).toHaveLength(0)
    const retry = f.wait("live_parent_recovery_attempt")
    f.advance(5_000)
    await retry
    expect(f.specs).toHaveLength(2)
    const ended = f.wait("suspended_unresumable")
    f.advance(300_000)
    await ended
    expect(f.specs).toHaveLength(3)
    expect(f.messages).toHaveLength(1)
    expect(f.terminals).toHaveLength(1)
    const text = f.messages[0]?.content ?? ""
    expect(text).toContain("Investigate saved findings")
    expect(text).toMatch(/because|could not|couldn't/)
    expect(text).toMatch(/retry|Retry/)
    expect(text).toContain(`id:${f.id}`)
    expect(text).not.toMatch(/host_shard|shard|pid|deadbeef|suspended|rpc_|residency/i)
    f.advance(600_000)
    await bounded(f.lifecycle.cleanupExpiredRecords())
    f.notifier.reconcileUnnotifiedNotifications({ sessionId: "parent-1", parentState: { kind: "idle" } })
    expect(f.messages).toHaveLength(1)
    expect(f.specs).toHaveLength(3)
  })
})
