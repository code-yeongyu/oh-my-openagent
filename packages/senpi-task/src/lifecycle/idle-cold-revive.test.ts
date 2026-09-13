import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { coldReviveHarness } from "./__fixtures__/cold-revive-harness"
import { realColdRevive } from "./__fixtures__/real-cold-revive"
import { idleReplacementCycles } from "./__fixtures__/idle-replacement-cycles"
import { parseTaskRecord } from "../store/record-parse"
import { mapSendOutcome } from "../tools/control/send-results"
import { join } from "node:path"
import { createTaskManager } from "../manager/manager"
import { FakeRunner, cleanupProjects, makeHandle, settings, tempProject } from "../manager/__fixtures__/manager-fakes"
import type { ManagedStartSpec } from "../manager/types"
import { createTaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { createTaskLifecycle } from "./create"
import { FakeRegistry } from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

describe("idle cold revival", () => {
  test("#given four concurrent children #when replacements cycle four times across idle parking #then ordinary idle children remain continuable", async () => {
    expect(await idleReplacementCycles()).toMatchObject({ cycles: 4, concurrentTurns: 4, peakResidents: 4, evicted: 0, nonContinuable: 0 })
  })

  test("#given configured idle retention #when an acknowledged send refreshes updated_at #then the old boundary cannot park it", async () => {
    const result = await realColdRevive("in-process", false, { idleTimeoutMs: 37 })
    expect(result).toMatchObject({ cadenceMs: 37, earlyParkAfterSend: false, parked: "persisted_only", messageCount: 1 })
  }, 20000)

  for (const policy of ["recorded_warn", "recorded_silent", "refuse"] as const) {
    for (const generation of [undefined, 1, 2]) {
      test(`#given ${policy} and generation ${generation} #when cold revived #then unknown is not mismatch and policy is enforced`, async () => {
        // given
        const h = coldReviveHarness({ policy, ...(generation === undefined ? {} : { generation }) })
        try {
          // when
          const result = await h.send()
          // then
          const denied = policy === "refuse" && generation === 1
          expect(result.kind).toBe(denied ? "config_generation_mismatch" : "revived")
          expect(h.resumed.length).toBe(denied ? 0 : 1)
          expect(h.warnings.length).toBe(policy === "recorded_warn" && generation === 1 ? 1 : 0)
          expect(h.store.load(h.record.task_id)?.config_generation).toBe(generation)
          if (h.warnings.length) expect(h.warnings[0]).toMatchObject({ code: "config_generation_mismatch", recorded_generation: 1, current_generation: 2, parent_session_id: "parent" })
        } finally { await h.dispose() }
      })
    }
  }

  test("#given malformed stored generation #when parsed #then validation still fails", () => {
    const h = coldReviveHarness()
    try { expect(() => parseTaskRecord({ ...h.record, config_generation: "invalid" }, "fixture")).toThrow() }
    finally { h.lifecycle.dispose?.() }
  })

  for (const failure of ["cwd", "transcript", "spec", "killed", "foreign", "cancelled", "lost", "one-shot"] as const) {
    test(`#given ${failure} #when cold send is attempted #then zero spawns and no epoch change`, async () => {
      const h = coldReviveHarness()
      if (failure === "transcript") rmSync(h.sessionPath)
      h.store.mutate(h.record.task_id, (record) => {
        switch (failure) {
          case "cwd": return { ...record, spawn_spec: { version: 1, cwd: join(h.project, "missing"), prompt: "recorded" } }
          case "spec": { const { spawn_spec: _spec, ...rest } = record; return rest }
          case "killed": return { ...record, killed: true }
          case "foreign": return { ...record, host_pid: process.pid + 1 }
          case "cancelled": case "lost": return { ...record, status: failure }
          case "one-shot": return { ...record, agent_type: "plan-reviewer" }
          case "transcript": return record
        }
      })
      try {
        const result = await h.send()
        expect(result.kind).toBe(failure === "cwd" ? "cwd_unavailable" : failure === "foreign" ? "admission_refused" : failure === "one-shot" ? "one_shot_agent" : "not_continuable")
        expect(h.resumed.length).toBe(0)
        expect(h.store.load(h.record.task_id)?.notification.run_epoch).toBe(0)
      } finally { await h.dispose() }
    })
  }

  test("#given full residency #when send claims #then typed refusal releases the lane", async () => {
    const h = coldReviveHarness({ cap: 1 })
    const holder = { ...h.record, task_id: "st_00000901", residency_state: "resident", status: "running", host_pid: process.pid } as const
    h.store.save(holder)
    try {
      const result = await h.send()
      expect(result).toMatchObject({ kind: "admission_refused", reason: "residency_capacity" })
      expect(mapSendOutcome(result).isError).toBe(true)
      expect(h.resumed.length).toBe(0)
      h.store.remove(holder.task_id)
      expect((await h.send()).kind).toBe("revived")
    } finally { await h.dispose() }
  })

  test("#given a deferred resume #when two sends race with the reaper #then one spawns and no success precedes ack", async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const h = coldReviveHarness({ resume: async (_spec, _path, handle) => { entered.resolve(); await release.promise; return handle } })
    let acknowledged = false
    const first = h.send().then((result) => { acknowledged = true; return result })
    try {
      await Promise.race([entered.promise, first.then((result) => { throw new Error(`send returned before resume: ${result.kind}`) })])
      expect(acknowledged).toBe(false)
      expect(await h.send("SECOND_MESSAGE")).toMatchObject({ kind: "admission_refused", reason: "revival_in_progress" })
      expect(await h.lifecycle.reclaimIdleResidents?.()).toEqual([])
      expect(h.resumed.length).toBe(1)
    } finally { release.resolve() }
    try { expect((await first).kind).toBe("revived"); expect(h.fake.followUpCalls).toEqual(["CONTINUE_SENTINEL"]) }
    finally { await h.dispose() }
  })

  test("#given failed resume #when a claimed slot rolls back #then persisted residency and pending messages survive", async () => {
    const h = coldReviveHarness({ resume: async () => { throw new Error("fixture resume failure") } })
    h.store.mutate(h.record.task_id, (record) => ({ ...record, pending_steering: [{ id: "p1", message: "PENDING", deliver_as: "steer" }] }))
    try {
      expect((await h.send()).kind).toBe("not_continuable")
      expect(h.store.load(h.record.task_id)).toMatchObject({ residency_state: "persisted_only", notification: { run_epoch: 0 }, pending_steering: [{ id: "p1", message: "PENDING", deliver_as: "steer" }] })
      expect(h.store.load(h.record.task_id)?.host_pid).toBeUndefined()
      const next = await h.manager.start({ prompt: "next", parent_session_id: "parent", depth: 1 })
      expect(next).toMatchObject({ kind: "started", status: "running" })
      if (next.kind === "started") await h.manager.cancelTask(next.task_id)
    } finally { await h.dispose() }
  })

  test("#given a pending delivery ack #when cancel wins #then late ack cannot report a revived child", async () => {
    const entered = Promise.withResolvers<void>()
    const ack = Promise.withResolvers<void>()
    const h = coldReviveHarness({ resume: async (_spec, _path, handle) => ({ ...handle, followUp: async () => { entered.resolve(); await ack.promise } }) })
    const send = h.send()
    try {
      await Promise.race([entered.promise, send.then((result) => { throw new Error(`send returned before delivery: ${result.kind}`) })])
      expect((await h.manager.cancelTask(h.record.task_id)).kind).toBe("cancelled")
    } finally { ack.resolve() }
    try {
      expect((await send).kind).toBe("not_continuable")
      expect(h.store.load(h.record.task_id)?.status).toBe("cancelled")
    } finally { await h.dispose() }
  })

  test("#given uncertain delivery #when the same message is repeated #then the recorded epoch is not resent", async () => {
    let attempts = 0
    const h = coldReviveHarness({ resume: async (_spec, _path, handle) => ({ ...handle, hasExited: () => true, followUp: async () => { attempts += 1; throw new Error("ack lost") } }) })
    try {
      expect((await h.send()).kind).toBe("delivery_uncertain")
      expect((await h.send()).kind).toBe("delivery_uncertain")
      expect(attempts).toBe(1)
      expect(h.store.load(h.record.task_id)?.revive_delivery_uncertain?.run_epoch).toBe(1)
    } finally { await h.dispose() }
  })

  test("#given an acknowledged pending batch #when queue bookkeeping fails #then durable uncertainty prevents replay", async () => {
    let delivered = false
    const h = coldReviveHarness({
      resume: async (_spec, _path, handle) => ({ ...handle, followUp: async (message) => { await handle.followUp(message); delivered = true } }),
      storeWrapper: (store) => ({ ...store, mutate: (id, update) => store.mutate(id, (fresh) => {
        const next = update(fresh)
        if (delivered && next.pending_steering?.length === 0) throw new Error("queue ack persistence failed")
        return next
      }) }),
    })
    h.store.mutate(h.record.task_id, (record) => ({ ...record, pending_steering: [{ id: "p1", message: "PENDING", deliver_as: "steer" }] }))
    try {
      expect((await h.send()).kind).toBe("delivery_uncertain")
      expect(h.store.load(h.record.task_id)?.revive_delivery_uncertain?.run_epoch).toBe(1)
      expect((await h.send()).kind).toBe("delivery_uncertain")
      expect(h.fake.followUpCalls).toEqual(["PENDING\n\nCONTINUE_SENTINEL"])
    } finally { delivered = false; await h.dispose() }
  })

  test("#given pending messages #when delivery acknowledges #then the batch is delivered and its entries clear", async () => {
    const h = coldReviveHarness()
    h.store.mutate(h.record.task_id, (record) => ({ ...record, pending_steering: [{ id: "p1", message: "PENDING", deliver_as: "steer" }] }))
    try {
      expect((await h.send()).kind).toBe("revived")
      expect(h.fake.followUpCalls).toEqual(["PENDING\n\nCONTINUE_SENTINEL"])
      expect(h.store.load(h.record.task_id)?.pending_steering).toBeUndefined()
    } finally { await h.dispose() }
  })

  test("#given a terminal persisted-only child #when task_send resumes it #then recorded session and policy reach one new epoch", async () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const record = { ...createTaskRecord({ parent_session_id: "parent", root_session_id: "parent", depth: 1, execution_mode: "in-process", model: "fixture/model", notify_on_terminal: false }), status: "completed", residency_state: "persisted_only", spawn_spec: { version: 1, cwd: project, prompt: "RECORDED_PROMPT", instructions: "RECORDED_INSTRUCTIONS" }, tool_allow: ["read"], tool_deny: ["write"] } as const
    store.save(record)
    const sessionDir = join(store.stateDir, "children", record.task_id, "sessions", record.task_id)
    mkdirSync(sessionDir, { recursive: true })
    const path = join(sessionDir, "fixture.jsonl")
    writeFileSync(path, '{"role":"assistant","content":"TRANSCRIPT_SENTINEL"}\n')
    const fake = makeHandle(record.task_id)
    const resumed: Array<{ spec: ManagedStartSpec; path: string }> = []
    const manager = createTaskManager({ store, cwd: project, config: settings(), planner: () => { throw new Error("must not replan") }, runners: { "in-process": { start: () => { throw new Error("must not start fresh") }, resume: async (spec, path) => { resumed.push({ spec, path }); return fake.handle } }, process: new FakeRunner() } })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings() })
    try {
      // when
      const result = await manager.sendToTask({ idOrName: record.task_id, callerSessionId: "parent", message: "CONTINUE_SENTINEL" })
      // then
      expect(result).toEqual({ kind: "revived", task_id: record.task_id, run_epoch: 1 })
      expect(resumed).toHaveLength(1)
      expect(resumed[0]?.path).toBe(path)
      expect(resumed[0]?.spec).toMatchObject({ cwd: project, prompt: "RECORDED_PROMPT", instructions: "RECORDED_INSTRUCTIONS", toolAllowlist: ["read"], toolDenylist: ["write"], model: "fixture/model" })
      expect(fake.followUpCalls).toEqual(["CONTINUE_SENTINEL"])
    } finally { lifecycle.dispose?.(); manager.forget(record.task_id) }
  })
})
