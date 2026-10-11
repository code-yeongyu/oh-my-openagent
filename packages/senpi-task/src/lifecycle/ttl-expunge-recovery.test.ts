import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import type { TaskRecordStore } from "../store"
import { createTaskLifecycle } from "./create"
import {
  cleanupProjects,
  FakeRegistry,
  seedRecord,
  settings,
  tempStore,
} from "./__fixtures__/lifecycle-fakes"
import { NO_HOST_ENDPOINT } from "./host-session"

afterEach(cleanupProjects)

const now = () => 100_000_000
const TTL = 10_000

function iso(ageMs: number): string {
  return new Date(now() - ageMs).toISOString()
}

function recordPath(store: TaskRecordStore, taskId: string): string {
  return join(store.stateDir, "tasks", `${taskId}.json`)
}

function seedChildArtifacts(store: TaskRecordStore, taskId: string): { readonly childDir: string } {
  store.appendEvent(taskId, { type: "seed", payload: {} })
  const childDir = join(store.stateDir, "children", taskId)
  mkdirSync(join(childDir, "sessions", taskId), { recursive: true })
  writeFileSync(join(childDir, "sessions", taskId, "x.jsonl"), '{"role":"user"}\n', "utf8")
  return { childDir }
}

describe("cleanupExpiredRecords tombstone recovery", () => {
  test("#given a tombstoned daemon child still held by the host #when recovery resumes #then it closes the session before deleting its directory", async () => {
    // given: the prior process crashed after tombstoning but before the daemon close completed
    const store = tempStore()
    const taskId = "st_00000027"
    const artifacts = seedChildArtifacts(store, taskId)
    const sessionPath = join(artifacts.childDir, "sessions", taskId, "x.jsonl")
    seedRecord(store, {
      task_id: taskId,
      status: "completed",
      residency_state: "rpc_detached",
      execution_mode: "process",
      runner_kind: "host-session",
      host_session: {
        socket: "/tmp/omo-8960.sock",
        routing_id: "routing-27",
        session_path: sessionPath,
        instance_id: "instance-27",
      },
      updated_at: iso(TTL + 1000),
    })
    const tombstonePath = `${recordPath(store, taskId)}.expunging`
    renameSync(recordPath(store, taskId), tombstonePath)
    const childDirExistedAtClose: boolean[] = []
    const lifecycle = createTaskLifecycle({
      hostEndpoint: NO_HOST_ENDPOINT,
      store,
      registry: new FakeRegistry(),
      config: settings({ ttl_ms: TTL }),
      now,
      hostSessionProbe: {
        daemonAlive: () => Promise.resolve(true),
        sessionLive: () => Promise.resolve(true),
        sessionLiveness: () => Promise.resolve("live" as const),
        refresh: () => {},
      },
      hostSessionClose: async () => {
        childDirExistedAtClose.push(existsSync(artifacts.childDir))
      },
    })

    // when
    const result = await lifecycle.cleanupExpiredRecords()

    // then
    expect(childDirExistedAtClose).toEqual([true])
    expect(result.deleted).toContain(taskId)
    expect(existsSync(artifacts.childDir)).toBe(false)
    expect(existsSync(tombstonePath)).toBe(false)
  })

  test("#given one malformed and one valid tombstone #when recovery resumes #then both expunges finish without wedging the sweep", async () => {
    // given
    const store = tempStore()
    const malformedId = "st_00000028"
    const validId = "st_00000029"
    const malformedArtifacts = seedChildArtifacts(store, malformedId)
    const validArtifacts = seedChildArtifacts(store, validId)
    mkdirSync(join(store.stateDir, "tasks"), { recursive: true })
    writeFileSync(`${recordPath(store, malformedId)}.expunging`, "{}\n", "utf8")
    seedRecord(store, {
      task_id: validId,
      status: "completed",
      residency_state: "persisted_only",
      updated_at: iso(TTL + 1000),
    })
    renameSync(recordPath(store, validId), `${recordPath(store, validId)}.expunging`)
    const lifecycle = createTaskLifecycle({
      hostEndpoint: NO_HOST_ENDPOINT,
      store,
      registry: new FakeRegistry(),
      config: settings({ ttl_ms: TTL }),
      now,
    })

    // when
    const result = await lifecycle.cleanupExpiredRecords()

    // then
    expect(result.deleted).toEqual([malformedId, validId])
    expect(existsSync(`${recordPath(store, malformedId)}.expunging`)).toBe(false)
    expect(existsSync(`${recordPath(store, validId)}.expunging`)).toBe(false)
    expect(existsSync(malformedArtifacts.childDir)).toBe(false)
    expect(existsSync(validArtifacts.childDir)).toBe(false)
  })

  test("#given an old process tombstone #when recovery resumes #then it never signals a possibly reused pid", async () => {
    // given
    const store = tempStore()
    const taskId = "st_00000030"
    const artifacts = seedChildArtifacts(store, taskId)
    seedRecord(store, {
      task_id: taskId,
      status: "completed",
      residency_state: "rpc_detached",
      execution_mode: "process",
      pid: 4242,
      updated_at: iso(TTL + 1000),
    })
    renameSync(recordPath(store, taskId), `${recordPath(store, taskId)}.expunging`)
    const signals: string[] = []
    const lifecycle = createTaskLifecycle({
      hostEndpoint: NO_HOST_ENDPOINT,
      store,
      registry: new FakeRegistry(),
      config: settings({ ttl_ms: TTL }),
      now,
      signaller: {
        isAlive: () => true,
        signal: (_pid, signal) => {
          signals.push(signal)
        },
      },
    })

    // when
    const result = await lifecycle.cleanupExpiredRecords()

    // then
    expect(signals).toEqual([])
    expect(result.deleted).toContain(taskId)
    expect(existsSync(artifacts.childDir)).toBe(false)
  })
})
