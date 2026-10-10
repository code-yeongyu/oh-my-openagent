import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { runDaemonCommand } from "../bin/lib/daemon.js"
import { capture, endpoint, scriptedEngine, workspace, writeJson } from "./daemon-test-support"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const result = workspace()
  roots.push(result.root)
  const storeA = join(result.root, "project-a", ".omo", "senpi-task")
  const storeB = join(result.root, "custom-store")
  mkdirSync(storeA, { recursive: true })
  mkdirSync(storeB, { recursive: true })
  const shardRoot = join(result.agentDir, "rpc", "shards")
  const socketA = join(shardRoot, "p-aaaaaaaaaaaaaaaa.sock")
  const socketB = join(shardRoot, "p-bbbbbbbbbbbbbbbb.sock")
  writeJson(join(shardRoot, "p-aaaaaaaaaaaaaaaa.meta.json"), { socket: socketA, stores: [storeA] })
  writeJson(join(shardRoot, "p-bbbbbbbbbbbbbbbb.meta.json"), { socket: socketB })
  writeJson(join(result.agentDir, "rpc", "task-stores.json"), {
    version: 1,
    stores: {
      [storeA]: { first_seen: "2026-01-01T00:00:00.000Z", last_seen: "2026-01-01T00:00:00.000Z" },
      [storeB]: { first_seen: "2026-01-01T00:00:00.000Z", last_seen: "2026-01-01T00:00:00.000Z" },
    },
  })
  return { ...result, storeA, storeB, socketA, socketB }
}

describe("omo daemon rollback preparation", () => {
  test("#given migration warnings #when rollback prepares #then JSON and stderr both report the affected tasks", () => {
    const { pluginRoot, agentDir, storeA } = fixture()
    const warning = {
      code: "strict_closure_not_retried",
      task_ids: ["st_00000081"],
      message: "Old daemon session may still be running and will no longer be retried for close by the older binary.",
    }
    const migration = {
      run(request: Record<string, unknown>) {
        return {
          store_dir: request.storeDir,
          migrate: 0,
          migrated: 0,
          skipped: 1,
          sockets: [],
          ...(request.storeDir === storeA ? { warnings: [warning] } : {}),
        }
      },
    }
    const engine = scriptedEngine(() => ({ exitCode: 3, stdout: "" }))
    const stdout = capture()
    const stderr = capture()
    expect(
      runDaemonCommand(["rollback-prepare", "--json"], {
        engine,
        migration,
        pluginRoot,
        agentDir,
        env: {},
        stdout,
        stderr,
        platform: "darwin",
      }),
    ).toBe(0)
    expect(
      JSON.parse(stdout.text()).stores.find((entry: { store_dir: string }) => entry.store_dir === storeA).warnings,
    ).toEqual([warning])
    expect(stderr.text()).toContain(warning.task_ids[0] ?? "")
    expect(stderr.text()).toContain(warning.message)
  })
  test("#given complete index coverage and dead endpoints #when rollback prepares #then every store migrates", () => {
    const { pluginRoot, agentDir, storeA, socketA, socketB } = fixture()
    const requests: Record<string, unknown>[] = []
    const migration = {
      run(request: Record<string, unknown>) {
        requests.push(request)
        if (request.planOnly) {
          return {
            store_dir: request.storeDir,
            migrate: 1,
            skipped: 0,
            sockets: [request.storeDir === storeA ? socketA : socketB],
          }
        }
        return { store_dir: request.storeDir, migrate: 1, migrated: 1, skipped: 0, sockets: [] }
      },
    }
    const engine = scriptedEngine((args) => {
      const socket = args[args.indexOf("--socket") + 1]
      return { exitCode: 3, stdout: JSON.stringify(endpoint(socket ?? "", { reachable: false })) }
    })
    const stdout = capture()

    const exitCode = runDaemonCommand(["rollback-prepare", "--json"], {
      engine, migration, pluginRoot, agentDir, env: {}, stdout, stderr: capture(), platform: "darwin",
    })

    expect(exitCode).toBe(0)
    expect(requests.filter((request) => request.planOnly)).toHaveLength(2)
    expect(requests.filter((request) => !request.planOnly)).toHaveLength(2)
    const payload = JSON.parse(stdout.text())
    expect(payload.coverage.from_index).toBe(2)
    expect(payload.coverage.endpoints_without_store_map).toEqual([socketB])
  })

  test("#given one live endpoint #when rollback prepares #then no migration write runs", () => {
    const { pluginRoot, agentDir, socketA } = fixture()
    const writes: Record<string, unknown>[] = []
    const migration = {
      run(request: Record<string, unknown>) {
        if (!request.planOnly) writes.push(request)
        return request.planOnly
          ? { store_dir: request.storeDir, migrate: 1, skipped: 0, sockets: [socketA] }
          : { store_dir: request.storeDir, migrate: 1, migrated: 1, skipped: 0, sockets: [] }
      },
    }
    const live = endpoint(socketA, { pid: 72, claimsLive: 1, shard: { kind: "p", key: "aaaaaaaaaaaaaaaa" } })
    const engine = scriptedEngine(() => ({ exitCode: 0, stdout: JSON.stringify(live) }))
    const stderr = capture()

    const exitCode = runDaemonCommand(["rollback-prepare"], {
      engine, migration, pluginRoot, agentDir, env: {}, stdout: capture(), stderr, platform: "darwin",
    })

    expect(exitCode).toBe(3)
    expect(writes).toHaveLength(0)
    expect(stderr.text()).toContain("endpoint still live")
    expect(stderr.text()).toContain(socketA)
  })

  test("#given sidecars but no index #when rollback lacks an explicit inventory #then it refuses before planning", () => {
    const { pluginRoot, agentDir } = fixture()
    rmSync(join(agentDir, "rpc", "task-stores.json"))
    const requests: Record<string, unknown>[] = []
    const migration = { run(request: Record<string, unknown>) { requests.push(request); return {} } }
    const engine = scriptedEngine(() => ({ exitCode: 3, stdout: "" }))
    const stderr = capture()

    const exitCode = runDaemonCommand(["rollback-prepare"], {
      engine, migration, pluginRoot, agentDir, env: {}, stdout: capture(), stderr, platform: "darwin",
    })

    expect(exitCode).toBe(3)
    expect(requests).toHaveLength(0)
    expect(stderr.text()).toContain("store index missing")
  })
})
