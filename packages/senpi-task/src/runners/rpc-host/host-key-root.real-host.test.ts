import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadSenpiBarrel, senpiProbeHost } from "../../lazy/senpi-barrel"
import { type SocketHost, startSocketHost } from "../../manager/__fixtures__/model-chain-engines"
import { ENGINE_MODELS, startHttpProviders, type HttpProviders } from "../../manager/__fixtures__/model-chain-http"
import { closeHostSession } from "./close"
import { TASK_DAEMON_PROTOCOL_VERSION } from "./daemon-contract"
import { liveSessionPaths } from "./liveness"
import { HostSessionClient } from "./session-client"
import { probeWithEngine, type HostSessionOpenInput } from "./session-transport"

// senpi#7568 (in the 2026.11.28 pin): the engine's RPC client refuses a host that challenges under a launch whose key
// record is not under the key root the client names. omo launches each task host in ITS agent dir, where the host
// writes its launch key; this process's engine keeps its own agent dir elsewhere (the test preload's), as a plain senpi
// running the omo plugin with OMO_CODING_AGENT_DIR set does. Security contract: a task host is proven only under the
// dir it was launched in; a root that holds no record of its launch, or no root at all, proves nothing and sends nothing.

const BUDGET_MS = 30_000
setDefaultTimeout(BUDGET_MS)

const roots: string[] = []
const hosts: SocketHost[] = []
const providers: HttpProviders[] = []
const clients: HostSessionClient[] = []

afterEach(async () => {
  for (const client of clients.splice(0)) await client.detach()
  for (const host of hosts.splice(0)) await host.stop()
  for (const provider of providers.splice(0)) await provider.stop()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

type LaunchedHost = { readonly root: string; readonly socket: string; readonly launchDir: string }

/** A real senpi socket host launched in its own agent dir, which is not this process's engine agent dir. */
async function hostInOwnAgentDir(): Promise<LaunchedHost> {
  const root = mkdtempSync(join(tmpdir(), "rh-key-root-"))
  roots.push(root)
  const home = join(root, "home")
  const launchDir = join(root, "agent")
  mkdirSync(home, { recursive: true })
  // The host refuses a group/other-writable agent dir (#12131).
  mkdirSync(launchDir, { recursive: true, mode: 0o700 })
  const provider = startHttpProviders({})
  providers.push(provider)
  writeFileSync(join(launchDir, "models.json"), provider.modelsJson)
  writeFileSync(
    join(launchDir, "auth.json"),
    JSON.stringify(
      Object.fromEntries(Object.keys(ENGINE_MODELS).map((name) => [name, { type: "api_key", key: "test-key" }])),
    ),
    { mode: 0o600 },
  )
  const host = await startSocketHost(root, {
    PATH: process.env["PATH"] ?? "",
    HOME: home,
    SENPI_CODING_AGENT_DIR: launchDir,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  })
  hosts.push(host)
  return { root, socket: host.socket, launchDir }
}

function otherKeyRoot(root: string): string {
  const other = join(root, "other-agent")
  mkdirSync(join(other, "rpc", "keys"), { recursive: true, mode: 0o700 })
  return other
}

/** A fresh path that is a symlink to `target`, so a dir spelled through it resolves to whatever `target` holds. */
function symlinkTo(target: string): string {
  const parent = mkdtempSync(join(tmpdir(), "rh-key-link-"))
  roots.push(parent)
  const link = join(parent, "link")
  symlinkSync(target, link)
  return link
}

const CHILD_SESSION = join("sessions", "child.jsonl")

/**
 * The host lists a session by its canonical path while omo keeps the path it asked for; the lifecycle compares the two
 * canonically (#8932), so these checks do too. The temp root keeps its as-given spelling (macOS hands out /var/... for
 * /private/var/...), so every key-root proof here still runs under the spelling a caller passes.
 */
function listedSessionPath(root: string): string {
  return join(realpathSync(root), CHILD_SESSION)
}

function childOpen(root: string): HostSessionOpenInput {
  return {
    sessionPath: join(root, CHILD_SESSION),
    cwd: root,
    provider: "anthropic",
    modelId: "claude-opus-5",
    thinkingLevel: "medium",
    kind: "worker",
    context: { role: "child", task_id: "st_key_root" },
    retainOnDisconnect: true,
    autoTitle: false,
  }
}

function client(socket: string, keyRoot: string): HostSessionClient {
  const opened = new HostSessionClient({ socketPath: socket, keyRoot })
  clients.push(opened)
  return opened
}

describe.skipIf(process.platform === "win32")("a task host proven under the agent dir it was launched in", () => {
  test("#given a host launched in omo's agent dir #when the engine probes it under its own default root #then the host is refused as unproven", async () => {
    // given
    const { socket } = await hostInOwnAgentDir()
    await loadSenpiBarrel()

    // when / then: the shape every omo dial had at the pin alone
    await expect(senpiProbeHost()({ socket })).rejects.toMatchObject({ code: "host_identity_unproven" })
  })

  test("#given the same host #when omo probes it and opens a child naming the dir the host was launched in #then the host answers and the child's session opens on it", async () => {
    // given
    const { root, socket, launchDir } = await hostInOwnAgentDir()

    // when
    const info = await probeWithEngine(socket, launchDir)
    const child = client(socket, launchDir)
    await child.open(childOpen(root))

    // then
    expect(info).toMatchObject({ protocolVersion: TASK_DAEMON_PROTOCOL_VERSION })
    expect(child.sessionId).toBeDefined()
    expect(await liveSessionPaths(socket, launchDir)).toContain(listedSessionPath(root))
  })

  test("#given a key root that holds no record of the host's launch #when omo probes the host or opens a child naming it #then the host is refused as unproven and no session opens", async () => {
    // given
    const { root, socket, launchDir } = await hostInOwnAgentDir()
    const elsewhere = otherKeyRoot(root)

    // when / then
    await expect(probeWithEngine(socket, elsewhere)).rejects.toMatchObject({ code: "host_identity_unproven" })
    await expect(client(socket, elsewhere).open(childOpen(root))).rejects.toMatchObject({
      code: "host_identity_unproven",
    })
    expect(await liveSessionPaths(socket, launchDir)).not.toContain(listedSessionPath(root))
  })

  test("#given a retained child session #when the lifecycle names no key root #then nothing is listed or closed, and naming the launch dir closes it", async () => {
    // given
    const { root, socket, launchDir } = await hostInOwnAgentDir()
    const child = client(socket, launchDir)
    await child.open(childOpen(root))
    const routing = child.sessionId ?? ""
    await child.detach()
    const hostSession = { socket, routing_id: routing, session_path: childOpen(root).sessionPath, instance_id: "" }

    // when
    const unnamed = await closeHostSession({ hostSession, cwd: root })

    // then
    expect(unnamed).toBe("unreachable")
    await expect(liveSessionPaths(socket, undefined)).rejects.toThrow("no key root")
    expect(await liveSessionPaths(socket, launchDir)).toContain(listedSessionPath(root))
    expect(await closeHostSession({ hostSession, cwd: root }, { keyRoot: launchDir })).toBe("closed")
    expect(await liveSessionPaths(socket, launchDir)).not.toContain(listedSessionPath(root))
  })

  test("#given a key root that reaches the launch dir through a symlinked parent #when omo probes the host and opens a child naming it #then the host is proven and the child's session opens on it", async () => {
    // given: the launch dir spelled another way, as macOS spells /private/var/... through /var
    const { root, socket } = await hostInOwnAgentDir()
    const aliased = join(symlinkTo(root), "agent")

    // when
    const info = await probeWithEngine(socket, aliased)
    const child = client(socket, aliased)
    await child.open(childOpen(root))

    // then
    expect(info).toMatchObject({ protocolVersion: TASK_DAEMON_PROTOCOL_VERSION })
    expect(await liveSessionPaths(socket, aliased)).toContain(listedSessionPath(root))
  })

  test("#given a key root with the launch dir's name under a symlinked parent that points at another agent tree #when omo probes the host or opens a child naming it #then the host is refused as unproven and no session opens", async () => {
    // given: the same shape as the aliased case; only the symlink's target differs, and that tree holds no record of this launch
    const { root, socket, launchDir } = await hostInOwnAgentDir()
    const otherTree = join(root, "other-tree")
    mkdirSync(join(otherTree, "agent", "rpc", "keys"), { recursive: true, mode: 0o700 })
    const elsewhere = join(symlinkTo(otherTree), "agent")

    // when / then
    await expect(probeWithEngine(socket, elsewhere)).rejects.toMatchObject({ code: "host_identity_unproven" })
    await expect(client(socket, elsewhere).open(childOpen(root))).rejects.toMatchObject({
      code: "host_identity_unproven",
    })
    expect(await liveSessionPaths(socket, launchDir)).not.toContain(listedSessionPath(root))
  })
})
