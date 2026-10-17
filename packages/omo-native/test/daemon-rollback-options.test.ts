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
  const storeDir = join(result.root, "project", ".omo", "senpi-task")
  const missingStore = join(result.root, "missing-store")
  const socket = join(result.agentDir, "rpc", "shards", "p-aaaaaaaaaaaaaaaa.sock")
  mkdirSync(storeDir, { recursive: true })
  writeJson(join(result.agentDir, "rpc", "shards", "p-aaaaaaaaaaaaaaaa.meta.json"), {
    socket,
    stores: [storeDir],
  })
  return { ...result, storeDir, missingStore, socket }
}

function migrationFixture(socket: string) {
  const requests: Record<string, unknown>[] = []
  return {
    requests,
    migration: {
      run(request: Record<string, unknown>) {
        requests.push(request)
        if (request.planOnly) {
          return { store_dir: request.storeDir, migrate: 1, skipped: 0, sockets: [socket] }
        }
        return { store_dir: request.storeDir, migrate: 1, migrated: 1, skipped: 0, sockets: [socket] }
      },
    },
  }
}

function deadEngine(socket: string) {
  return scriptedEngine((args) => {
    if (args.includes("--all")) {
      return {
        exitCode: 3,
        stdout: JSON.stringify({ endpoints: [endpoint(socket, { reachable: false })] }),
      }
    }
    return {
      exitCode: 3,
      stdout: JSON.stringify(endpoint(socket, { reachable: false, generations: [], claimsLive: 0 })),
    }
  })
}

describe("omo daemon rollback coverage options", () => {
  test("#given no index #when every store is explicit #then rollback proceeds and reports a missing store", () => {
    const { pluginRoot, agentDir, storeDir, missingStore, socket } = fixture()
    const { migration, requests } = migrationFixture(socket)
    const stdout = capture()

    const exitCode = runDaemonCommand([
      "rollback-prepare",
      "--json",
      "--store",
      storeDir,
      "--store",
      missingStore,
    ], {
      engine: deadEngine(socket),
      migration,
      pluginRoot,
      agentDir,
      env: {},
      stdout,
      stderr: capture(),
      platform: "darwin",
    })

    const payload = JSON.parse(stdout.text())
    expect(exitCode).toBe(0)
    expect(payload.coverage.from_store).toBe(2)
    expect(payload.coverage.missing).toEqual([missingStore])
    expect(requests.some((request) => request.storeDir === storeDir && !request.planOnly)).toBe(true)
  })

  test("#given no index #when the operator allows missing coverage #then sidecar stores still migrate", () => {
    const { pluginRoot, agentDir, storeDir, socket } = fixture()
    const { migration, requests } = migrationFixture(socket)

    const exitCode = runDaemonCommand(["rollback-prepare", "--allow-missing-index"], {
      engine: deadEngine(socket),
      migration,
      pluginRoot,
      agentDir,
      env: {},
      stdout: capture(),
      stderr: capture(),
      platform: "darwin",
    })

    expect(exitCode).toBe(0)
    expect(requests.some((request) => request.storeDir === storeDir && !request.planOnly)).toBe(true)
  })

  test("#given unreadable endpoint status #when rollback preflights #then it fails closed before writes", () => {
    const { pluginRoot, agentDir, storeDir, socket } = fixture()
    const { migration, requests } = migrationFixture(socket)
    const engine = scriptedEngine((args) => args.includes("--all")
      ? { exitCode: 3, stdout: JSON.stringify({ endpoints: [] }) }
      : { exitCode: 3, stdout: "not-json" })
    const stderr = capture()

    const exitCode = runDaemonCommand(["rollback-prepare", "--store", storeDir], {
      engine,
      migration,
      pluginRoot,
      agentDir,
      env: {},
      stdout: capture(),
      stderr,
      platform: "darwin",
    })

    expect(exitCode).toBe(3)
    expect(stderr.text()).toContain(`endpoint status unreadable ${socket}`)
    expect(requests.filter((request) => !request.planOnly)).toHaveLength(0)
  })
})
