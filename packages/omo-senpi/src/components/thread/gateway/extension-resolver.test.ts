import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { canonicalEndpointPath } from "../endpoint-registry"
import { createExtensionResolver } from "./extension-resolver"

// An endpoint registered in the agent dir is how these tests see the live enumeration: a socket that counts the
// connections it gets (POSIX), or a dead endpoint whose reservations claim a session file that only the live view names.
const dirs: string[] = []
const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((done) => server.close(() => done()))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function registerEndpoint(agentDir: string, socket: string): string {
  const registry = join(agentDir, "rpc-host-daemon")
  const dir = join(registry, createHash("sha256").update(canonicalEndpointPath(socket)).digest("hex").slice(0, 16))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(registry, "layout.json"), JSON.stringify({ layout: 2, dir: "0000000000000000" }))
  writeFileSync(join(dir, "endpoint.json"), JSON.stringify({ registry_version: 1, endpoint_kind: "tui", socket }))
  return dir
}

async function registerCountingEndpoint(agentDir: string): Promise<() => number> {
  const socketDir = mkdtempSync(join(tmpdir(), "ext-res-sock-"))
  dirs.push(socketDir)
  const socket = join(socketDir, `t-${"0".repeat(16)}.sock`)
  writeFileSync(`${socket}.secret`, "secret")
  let connections = 0
  const server = createServer((connection) => {
    connections += 1
    connection.destroy()
  })
  servers.push(server)
  await new Promise<void>((done) => server.listen(socket, () => done()))
  registerEndpoint(agentDir, socket)
  return () => connections
}

// A terminal that exited holding a session: no socket, and only its reservation claim names the session file, which
// lives outside the caller's session directories so that nothing but the live view's dead-endpoint listing finds it.
function registerDeadEndpointClaiming(agentDir: string, durableId: string, name: string): void {
  const elsewhere = mkdtempSync(join(tmpdir(), "ext-res-claimed-"))
  dirs.push(elsewhere)
  const sessionPath = join(elsewhere, `2026-10-03_${durableId}.jsonl`)
  writeSession(sessionPath, durableId, name, agentDir)
  const dir = registerEndpoint(agentDir, join(elsewhere, `t-${"1".repeat(16)}.sock`))
  mkdirSync(join(dir, "reservations"), { recursive: true })
  writeFileSync(join(dir, "reservations", `${"2".repeat(16)}.json`), JSON.stringify({ sessionPath, pid: 1 }))
}

function writeSession(path: string, durableId: string, name: string, cwd: string): void {
  writeFileSync(
    path,
    [
      JSON.stringify({ type: "session", version: 3, id: durableId, timestamp: "2026-10-03T00:00:00.000Z", cwd }),
      JSON.stringify({ type: "session_info", name }),
    ].join("\n") + "\n",
  )
}

function agentWithSession(durableId: string, name: string): string {
  const agentDir = mkdtempSync(join(tmpdir(), "ext-resolver-"))
  dirs.push(agentDir)
  const sessions = join(agentDir, "sessions", "--work--")
  mkdirSync(sessions, { recursive: true })
  writeFileSync(
    join(sessions, `2026-10-03_${durableId}.jsonl`),
    [
      JSON.stringify({
        type: "session",
        version: 3,
        id: durableId,
        timestamp: "2026-10-03T00:00:00.000Z",
        cwd: agentDir,
      }),
      JSON.stringify({ type: "session_info", name }),
    ].join("\n") + "\n",
  )
  return agentDir
}

test("#given a target addressed by its durable id with a session file #when an extension resolves it #then it resolves from disk", async () => {
  const agentDir = agentWithSession("dur-target", "target")
  const resolve = createExtensionResolver(agentDir)

  const resolved = await resolve("dur-target", { all_scope: true })

  expect(resolved).toMatchObject({ kind: "ok", target: { durable_id: "dur-target" } })
})

// Unix-socket listeners only: Windows terminal endpoints are named pipes this fixture cannot stand in for.
test.skipIf(process.platform === "win32")(
  "#given a target addressed by its durable id with a session file #when an extension resolves it #then no live endpoint is dialed",
  async () => {
    const agentDir = agentWithSession("dur-target", "target")
    const connections = await registerCountingEndpoint(agentDir)
    const resolve = createExtensionResolver(agentDir)

    await resolve("dur-target", { all_scope: true })

    expect(connections()).toBe(0)
  },
)

test("#given a target addressed by name that only a dead endpoint's claim names #when an extension resolves it #then the live view finds it", async () => {
  const agentDir = agentWithSession("dur-other", "other-thread")
  registerDeadEndpointClaiming(agentDir, "dur-claimed", "claimed-thread")
  const resolve = createExtensionResolver(agentDir)

  const resolved = await resolve("claimed-thread", { all_scope: true })

  expect(resolved).toMatchObject({ kind: "ok", target: { durable_id: "dur-claimed" } })
})

test.skipIf(process.platform === "win32")(
  "#given a target addressed by name #when an extension resolves it #then live endpoints are dialed",
  async () => {
    const agentDir = agentWithSession("dur-named", "named-thread")
    const connections = await registerCountingEndpoint(agentDir)
    const resolve = createExtensionResolver(agentDir)

    await resolve("named-thread", { all_scope: true })

    expect(connections()).toBeGreaterThan(0)
  },
)
