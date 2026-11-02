import { configureSharedSubunitLogger } from "@oh-my-opencode/utils"
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createTaskRecord,
  SUSPENSION_REASONS,
  TASK_START_FAILURE_KINDS,
  TASK_START_FAILURE_REASONS,
  type TaskStartFailureReason,
} from "../state"
import { createTaskRecordStore } from "./record-store"
import {
  R0_FAILURE_REASONS as PRODUCTION_R0_FAILURE_REASONS,
  R0_SUSPENSION_REASONS as PRODUCTION_R0_SUSPENSION_REASONS,
} from "./rollback-r0-contract"
import { migrateHostSessionSockets, planHostSessionSocketMigration } from "./rollback-migrate"
import {
  parseR0PersistedReasons,
  R0_SOURCE_COMMIT,
  R0_SUSPENSION_REASONS,
  R0_TASK_START_FAILURE_REASONS,
} from "./__fixtures__/r0-ebd01f84e-reasons"
import { isSuspensionExpiry } from "../lifecycle/suspended-expiry"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function storeFixture() {
  const storeDir = mkdtempSync(join(tmpdir(), "senpi-task-rollback-"))
  roots.push(storeDir)
  const store = createTaskRecordStore({ project_dir: storeDir, task: { state_dir: storeDir } })
  const base = createTaskRecord({
    parent_session_id: "parent",
    root_session_id: "root",
    depth: 0,
    execution_mode: "process",
    model: "test/model",
    notify_on_terminal: false,
  })
  return { storeDir, store, base }
}

describe("rollback host-session migration", () => {
  test("#given an open strict obligation #when rollback prepares #then its report and warning log disclose lost close retries", () => {
    const { storeDir, store, base } = storeFixture()
    const messages: Array<{ message: string; data: unknown }> = []
    const closing = {
      host_session: {
        socket: "/tmp/rpc.sock",
        routing_id: "r",
        session_path: "/tmp/s.jsonl",
        instance_id: "i",
      },
      requires_confirmation: true,
    }
    store.save({
      ...base,
      failure_kind: "suspended_unresumable",
      fallback_closing_child: closing,
    })
    store.save({
      ...base,
      task_id: "st_00000099",
      fallback_closing_child: { host_session: closing.host_session },
    })
    configureSharedSubunitLogger((message, data) => messages.push({ message, data }))
    try {
      const result = migrateHostSessionSockets(storeDir, {
        to: "/tmp/rpc.sock",
        deadEndpoints: new Set(),
      })
      expect(result).toMatchObject({
        warnings: [
          {
            code: "strict_closure_not_retried",
            task_ids: [base.task_id],
          },
        ],
      })
      expect(messages).toContainEqual({
        message: expect.stringContaining("may still be running"),
        data: expect.objectContaining({
          level: "warn",
          code: "strict_closure_not_retried",
          task_ids: [base.task_id],
        }),
      })
      expect(messages[0]?.message).toContain("no longer be retried")
    } finally {
      configureSharedSubunitLogger(undefined)
    }
  })
  for (const status of ["running", "error"] as const) {
    test(`#given ${status} suspension expiry #when rollback prepares #then R0 reads the record and its closing obligation`, () => {
      const { storeDir, store, base } = storeFixture()
      const target = "/tmp/rpc.sock"
      const obligation = {
        host_session: {
          socket: target,
          routing_id: "old",
          session_path: "/tmp/old.jsonl",
          instance_id: "old-instance",
        },
        requires_confirmation: true,
      }
      store.save({
        ...base,
        status,
        killed: true,
        residency_state: "rpc_detached",
        failure_kind: "suspended_unresumable",
        error_message: "suspended_unresumable:host_unreachable",
        fallback_closing_child: obligation,
      })
      migrateHostSessionSockets(storeDir, {
        to: target,
        deadEndpoints: new Set(),
      })
      const raw = JSON.parse(readFileSync(join(storeDir, "tasks", `${base.task_id}.json`), "utf8"))
      expect(() => parseR0PersistedReasons(raw)).not.toThrow()
      expect(raw.failure_kind).toBe("session_unavailable")
      expect(raw.error_message).toBe("suspended_unresumable:host_unreachable")
      expect(raw.fallback_closing_child).toEqual(obligation)
      expect(store.list().records).toHaveLength(1)
      const restored = store.load(base.task_id)
      if (restored === null) throw new Error("rollback lost the record")
      expect(isSuspensionExpiry(restored)).toBe(true)
      expect(store.load(base.task_id)?.fallback_closing_child).toEqual(obligation)
      expect(
        migrateHostSessionSockets(storeDir, {
          to: target,
          deadEndpoints: new Set(),
        }).migrated,
      ).toBe(0)
    })
  }

  test("#given shard and rpc records #when migration runs #then only shard sockets move and one event is appended", () => {
    const { storeDir, store, base } = storeFixture()
    const shard = "/tmp/p-aaaaaaaaaaaaaaaa.sock"
    const target = "/tmp/rpc.sock"
    store.save({
      ...base,
      task_id: "st_00000001",
      runner_kind: "host-session",
      suspension_reason: "host_incompatible",
      host_session: { socket: shard, routing_id: "r1", session_path: "/tmp/s1.jsonl", instance_id: "i1" },
    })
    store.save({
      ...base,
      task_id: "st_00000002",
      runner_kind: "host-session",
      host_session: { socket: target, routing_id: "r2", session_path: "/tmp/s2.jsonl", instance_id: "i2" },
    })

    const result = migrateHostSessionSockets(storeDir, { to: target, deadEndpoints: new Set([shard]) })

    expect(result).toMatchObject({ migrate: 1, migrated: 1, skipped: 1, sockets: [shard] })
    expect(store.load("st_00000001")?.host_session?.socket).toBe(target)
    expect(store.load("st_00000001")?.suspension_reason).toBeUndefined()
    expect(store.load("st_00000002")?.host_session?.socket).toBe(target)
    const events = readFileSync(join(storeDir, "logs", "st_00000001.jsonl"), "utf8").trim().split("\n")
    expect(events).toHaveLength(1)
    expect(JSON.parse(events[0] ?? "{}")).toEqual({
      type: "host_session_migrated",
      payload: { from: shard, to: target, reason: "rollback" },
    })
  })

  test("#given an unverified endpoint #when migration is requested #then no record is rewritten", () => {
    const { storeDir, store, base } = storeFixture()
    const shard = "/tmp/p-bbbbbbbbbbbbbbbb.sock"
    store.save({
      ...base,
      task_id: "st_00000003",
      runner_kind: "host-session",
      host_session: { socket: shard, routing_id: "r3", session_path: "/tmp/s3.jsonl", instance_id: "i3" },
    })

    expect(() => migrateHostSessionSockets(storeDir, { to: "/tmp/rpc.sock", deadEndpoints: new Set() }))
      .toThrow("live or unverified endpoint")
    expect(store.load("st_00000003")?.host_session?.socket).toBe(shard)
  })

  test("#given a dry run #when migration is planned #then the store remains byte-identical", () => {
    const { storeDir, store, base } = storeFixture()
    const shard = "/tmp/p-cccccccccccccccc.sock"
    store.save({
      ...base,
      task_id: "st_00000004",
      runner_kind: "host-session",
      host_session: { socket: shard, routing_id: "r4", session_path: "/tmp/s4.jsonl", instance_id: "i4" },
    })
    const path = join(storeDir, "tasks", "st_00000004.json")
    const before = readFileSync(path)

    const plan = planHostSessionSocketMigration(storeDir, "/tmp/rpc.sock")
    const result = migrateHostSessionSockets(storeDir, {
      to: "/tmp/rpc.sock",
      deadEndpoints: new Set([shard]),
      dryRun: true,
    })

    expect(plan.migrate).toBe(1)
    expect(result.migrated).toBe(0)
    expect(readFileSync(path)).toEqual(before)
  })

  test("#given every current persisted reason #when rollback prepares #then an R0-equivalent strict parser accepts every record", () => {
    const { storeDir, store, base } = storeFixture()
    const target = "/tmp/rpc.sock"
    let ordinal = 16
    const knownRecordPaths: string[] = []
    const r0SuspensionReasons = new Set<string>(R0_SUSPENSION_REASONS)
    const r0FailureReasons = new Set<string>(R0_TASK_START_FAILURE_REASONS)
    for (const failureKind of TASK_START_FAILURE_KINDS) {
      const taskId = `st_${ordinal.toString(16).padStart(8, "0")}`
      store.save({ ...base, task_id: taskId, failure_kind: failureKind })
      ordinal += 1
    }
    for (const suspensionReason of SUSPENSION_REASONS) {
      const taskId = `st_${ordinal.toString(16).padStart(8, "0")}`
      store.save({
        ...base,
        task_id: taskId,
        runner_kind: "host-session",
        suspension_reason: suspensionReason,
        host_session: {
          socket: target,
          routing_id: `s-${ordinal}`,
          session_path: `/tmp/s-${ordinal}.jsonl`,
          instance_id: `i-${ordinal}`,
        },
      })
      if (r0SuspensionReasons.has(suspensionReason)) {
        knownRecordPaths.push(join(storeDir, "tasks", `${taskId}.json`))
      }
      ordinal += 1
    }
    for (const failureReason of TASK_START_FAILURE_REASONS) {
      const taskId = `st_${ordinal.toString(16).padStart(8, "0")}`
      store.save({
        ...base,
        task_id: taskId,
        failure_kind: failureKindFor(failureReason),
        failure_reason: failureReason,
      })
      if (r0FailureReasons.has(failureReason)) {
        knownRecordPaths.push(join(storeDir, "tasks", `${taskId}.json`))
      }
      ordinal += 1
    }
    const knownBytesBefore = new Map(knownRecordPaths.map((path) => [path, readFileSync(path)]))

    const result = migrateHostSessionSockets(storeDir, { to: target, deadEndpoints: new Set() })

    expect(R0_SOURCE_COMMIT).toBe("ebd01f84e")
    expect(PRODUCTION_R0_SUSPENSION_REASONS).toEqual(R0_SUSPENSION_REASONS)
    expect(PRODUCTION_R0_FAILURE_REASONS).toEqual(R0_TASK_START_FAILURE_REASONS)
    expect(result.sockets).toEqual([])
    expect(result.migrated).toBeGreaterThan(0)
    const taskFiles = Array.from(
      { length: ordinal - 16 },
      (_, index) => join(storeDir, "tasks", `st_${(index + 16).toString(16).padStart(8, "0")}.json`),
    )
    for (const path of taskFiles) {
      const record = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
      expect(() => parseR0PersistedReasons(record)).not.toThrow()
    }
    for (const [path, before] of knownBytesBefore) expect(readFileSync(path)).toEqual(before)
  })
})

function failureKindFor(reason: TaskStartFailureReason) {
  if (
    reason === "model_not_in_child_profile" ||
    reason === "catalog_probe_timed_out" ||
    reason === "catalog_probe_failed"
  ) {
    return "model_unavailable" as const
  }
  if (
    reason === "protocol" ||
    reason === "capability" ||
    reason === "engine_mismatch" ||
    reason === "engine_refused" ||
    reason === "win32" ||
    reason === "runtime" ||
    reason === "host_unreachable" ||
    reason === "ensure_failed" ||
    reason === "ensure_timed_out" ||
    reason === "shard_socket_too_long" ||
    reason === "shard_alt_root_unsafe" ||
    reason === "legacy_host" ||
    reason === "host_incompatible" ||
    reason === "store_index_unavailable" ||
    reason === "own_host_unreachable" ||
    reason === "shard_identity_missing"
  ) {
    return "host_unavailable" as const
  }
  return "session-create-failed" as const
}
