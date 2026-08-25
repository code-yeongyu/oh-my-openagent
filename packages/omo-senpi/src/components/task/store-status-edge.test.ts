import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTaskRecord, createTaskRecordStore, type TaskRecord, type TaskRecordStore } from "@oh-my-opencode/senpi-task"

import { createMutationNotifyingStore } from "./store-mutation-observer"
import { createTaskTerminalObservers, type TaskTerminalEdge } from "./terminal-observers"

const projects: string[] = []

afterEach(() => {
  for (const dir of projects.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function harness(): {
  readonly store: TaskRecordStore
  readonly edges: TaskTerminalEdge[]
  readonly mutations: number[]
  readonly seed: (status: TaskRecord["status"]) => TaskRecord
} {
  const project = mkdtempSync(join(tmpdir(), "omo-senpi-status-edge-"))
  projects.push(project)
  const backing = createTaskRecordStore({ project_dir: project })
  const observers = createTaskTerminalObservers()
  const edges: TaskTerminalEdge[] = []
  observers.subscribe((edge) => edges.push(edge))
  const mutations: number[] = []
  const store = createMutationNotifyingStore(backing, () => mutations.push(mutations.length), observers)
  return {
    store,
    edges,
    mutations,
    seed: (status) => {
      const draft = createTaskRecord({
        parent_session_id: "parent-1",
        root_session_id: "parent-1",
        depth: 0,
        execution_mode: "in-process",
        model: "anthropic/claude-opus-5",
        notify_on_terminal: false,
        task_seq: 0,
      })
      const seeded: TaskRecord = { ...draft, status }
      backing.save(seeded)
      return seeded
    },
  }
}

describe("store status-edge observation", () => {
  test("#given a running record #when a reconciliation writes lost through replace #then exactly one terminal edge fires", () => {
    // given
    const { store, edges, seed } = harness()
    const running = seed("running")

    // when
    store.replace({ ...running, status: "lost", error_message: "host gone" })

    // then
    expect(edges).toHaveLength(1)
    expect(edges[0]?.record.status).toBe("lost")
    expect(edges[0]?.previousStatus).toBe("running")
  })

  test("#given an already lost record #when a lost-to-lost reason update is written #then zero terminal edges fire", () => {
    // given
    const { store, edges, seed } = harness()
    const lost = seed("lost")

    // when
    store.replace({ ...lost, error_message: "reason refined" })
    store.mutate(lost.task_id, (fresh) => ({ ...fresh, error_message: "refined again" }))

    // then
    expect(edges).toHaveLength(0)
  })

  test("#given a running record #when mutate writes a terminal status #then one terminal edge fires with the prior status", () => {
    // given
    const { store, edges, seed } = harness()
    const running = seed("running")

    // when
    store.mutate(running.task_id, (fresh) => ({ ...fresh, status: "interrupted" }))

    // then
    expect(edges).toHaveLength(1)
    expect(edges[0]?.record.status).toBe("interrupted")
    expect(edges[0]?.previousStatus).toBe("running")
  })

  test("#given a pending record #when a terminal transition applies #then one terminal edge fires", () => {
    // given
    const { store, edges, seed } = harness()
    const pending = seed("pending")

    // when
    store.transition(pending.task_id, { type: "cancel", timestamp: "2026-08-21T00:02:00.000Z" })

    // then
    expect(edges).toHaveLength(1)
    expect(edges[0]?.record.status).toBe("cancelled")
    expect(edges[0]?.previousStatus).toBe("pending")
  })

  test("#given a completed record #when a residency evict transition runs #then zero terminal edges fire", () => {
    // given
    const { store, edges, seed } = harness()
    const completed = seed("completed")

    // when
    store.transition(completed.task_id, { type: "evict", timestamp: "2026-08-21T00:02:00.000Z" })

    // then
    expect(edges).toHaveLength(0)
  })

  test("#given a save of a fresh terminal record #when the wrapper observes it #then one terminal edge fires with no prior status", () => {
    // given
    const { store, edges } = harness()
    const draft = createTaskRecord({
      parent_session_id: "parent-1",
      root_session_id: "parent-1",
      depth: 0,
      execution_mode: "in-process",
      model: "anthropic/claude-opus-5",
      notify_on_terminal: false,
    })

    // when
    store.save({ ...draft, status: "error", error_message: "died at birth" })

    // then
    expect(edges).toHaveLength(1)
    expect(edges[0]?.previousStatus).toBeUndefined()
  })

  test("#given an observer that throws #when a terminal write happens #then the store result is unaffected", () => {
    // given
    const project = mkdtempSync(join(tmpdir(), "omo-senpi-status-edge-throw-"))
    projects.push(project)
    const backing = createTaskRecordStore({ project_dir: project })
    const observers = createTaskTerminalObservers()
    observers.subscribe(() => {
      throw new Error("observer exploded")
    })
    let mutations = 0
    const store = createMutationNotifyingStore(backing, () => {
      mutations += 1
    }, observers)
    const draft = createTaskRecord({
      parent_session_id: "parent-1",
      root_session_id: "parent-1",
      depth: 0,
      execution_mode: "in-process",
      model: "anthropic/claude-opus-5",
      notify_on_terminal: false,
    })
    backing.save({ ...draft, status: "running" })

    // when
    const result = store.transition(draft.task_id, {
      type: "complete",
      timestamp: "2026-08-21T00:02:00.000Z",
      final_response: "done",
    })

    // then
    expect(result.applied).toBe(true)
    expect(result.record.status).toBe("completed")
    expect(mutations).toBe(1)
  })

  test("#given no observer ledger #when mutations run #then the debounced UI listener still fires for every write kind", () => {
    // given
    const project = mkdtempSync(join(tmpdir(), "omo-senpi-status-edge-ui-"))
    projects.push(project)
    const backing = createTaskRecordStore({ project_dir: project })
    let mutations = 0
    const store = createMutationNotifyingStore(backing, () => {
      mutations += 1
    })
    const draft = createTaskRecord({
      parent_session_id: "parent-1",
      root_session_id: "parent-1",
      depth: 0,
      execution_mode: "in-process",
      model: "anthropic/claude-opus-5",
      notify_on_terminal: false,
    })

    // when
    store.save({ ...draft, status: "running" })
    store.replace({ ...draft, status: "running", updated_at: "2026-08-21T00:03:00.000Z" })
    store.mutate(draft.task_id, (fresh) => ({ ...fresh, name: "renamed" }))
    store.transition(draft.task_id, { type: "complete", timestamp: "2026-08-21T00:04:00.000Z", final_response: "ok" })
    store.remove(draft.task_id)

    // then
    expect(mutations).toBe(5)
  })
})
