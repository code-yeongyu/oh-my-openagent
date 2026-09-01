import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "node:net"
import type { Server, Socket } from "node:net"

import { preflightMemoryModels, resetModelPreflightCacheForTests } from "./model-preflight"
import type { MemoryModelChain } from "./memory-model-attempts"
import { identityMatches, killIfAlive, pidAlive, pidTerminalWithin, readPidFileWhenWritten, readPidOnce, readPidWhenWritten, waitForFileToExist } from "./process-liveness.test-support"

const roots: string[] = []

const HELPER_EXIT_BOUND_MS = 5_000
const HELPER_FAILSAFE_BOUND_MS = 5_000

afterEach(async () => {
  resetModelPreflightCacheForTests()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const candidates: MemoryModelChain = [
  { model: "extension-only/primary", thinking: "off" },
  { model: "builtin/fallback", thinking: "minimal" },
]

async function fixture(body: string): Promise<{
  readonly root: string
  readonly launch: { readonly command: string; readonly prefixArgs: readonly string[] }
  readonly config: string
}> {
  const root = await mkdtemp(join(tmpdir(), "memory-model-preflight-"))
  roots.push(root)
  const launcher = join(root, "fake-senpi.mjs")
  const config = join(root, "omo.jsonc")
  await writeFile(launcher, `${body}\n`, "utf8")
  await writeFile(config, "{}\n", "utf8")
  return { root, launch: { command: process.execPath, prefixArgs: [launcher] }, config }
}

// Double server.close() raises ERR_SERVER_NOT_RUNNING under Node semantics; the try body closes
// the channel and the fail-safe finally must stay a no-op then.
const closedControlServers = new WeakSet<Server>()

function closeControlChannel(control: Server, connections: Set<Socket>): void {
  if (closedControlServers.has(control)) return
  for (const socket of connections) socket.destroy()
  connections.clear()
  control.close()
  closedControlServers.add(control)
}

describe("preflightMemoryModels", () => {
  test("#given a clean child catalog #when candidates are preflighted #then only child-visible candidates remain in order", async () => {
    // given
    const item = await fixture('process.stdout.write("builtin/fallback\\nother/model\\n")')

    // when
    const result = await preflightMemoryModels({
      candidates,
      launch: item.launch,
      env: { PATH: process.env.PATH },
      configSources: [{ path: item.config, exists: true }],
    })

    // then
    expect(result).toEqual({
      kind: "filtered",
      candidates: [{ model: "builtin/fallback", thinking: "minimal" }],
      rejected: [{ model: "extension-only/primary", cause: "model_not_visible" }],
    })
  })

  test("#given the same launcher and config mtime #when preflight runs twice #then the child catalog is probed once", async () => {
    // given
    const item = await fixture(`
import { appendFileSync } from "node:fs"
appendFileSync(process.env.PROBE_LOG, "probe\\n")
process.stdout.write("builtin/fallback\\n")
`)
    const probeLog = join(item.root, "probes.log")
    const input = {
      candidates,
      launch: item.launch,
      env: { PATH: process.env.PATH, PROBE_LOG: probeLog },
      configSources: [{ path: item.config, exists: true }],
    }

    // when
    await preflightMemoryModels(input)
    await preflightMemoryModels(input)

    // then
    expect(await Bun.file(probeLog).text()).toBe("probe\n")
  })

  test("#given a cached negative catalog #when preflight repeats before expiry #then it preserves reactive attempts instead of throwing none_visible", async () => {
    // given
    const item = await fixture(`
import { appendFileSync } from "node:fs"
appendFileSync(process.env.PROBE_LOG, "probe\\n")
process.stdout.write("other/model\\n")
`)
    const probeLog = join(item.root, "probes.log")
    const input = {
      candidates,
      launch: item.launch,
      env: { PATH: process.env.PATH, PROBE_LOG: probeLog },
      configSources: [{ path: item.config, exists: true }],
      now: () => 1_000,
    }
    const fresh = await preflightMemoryModels(input)

    // when
    const cached = await preflightMemoryModels(input)

    // then
    expect(fresh).toEqual({
      kind: "none_visible",
      rejected: candidates.map((candidate) => ({ model: candidate.model, cause: "model_not_visible" })),
    })
    expect(cached).toEqual({ kind: "unavailable", candidates })
    expect(await Bun.file(probeLog).text()).toBe("probe\n")
  })

  test("#given a cached negative catalog #when its ttl expires #then preflight probes again and observes newly visible credentials", async () => {
    // given
    const item = await fixture(`
import { appendFileSync, existsSync } from "node:fs"
appendFileSync(process.env.PROBE_LOG, "probe\\n")
process.stdout.write(existsSync(process.env.AUTH_READY) ? "builtin/fallback\\n" : "other/model\\n")
`)
    const probeLog = join(item.root, "probes.log")
    const authReady = join(item.root, "auth-ready")
    let now = 1_000
    const input = {
      candidates,
      launch: item.launch,
      env: { PATH: process.env.PATH, PROBE_LOG: probeLog, AUTH_READY: authReady },
      configSources: [{ path: item.config, exists: true }],
      now: () => now,
    }
    expect((await preflightMemoryModels(input)).kind).toBe("none_visible")
    await writeFile(authReady, "ready\n", "utf8")
    now += 2 * 60_000

    // when
    const refreshed = await preflightMemoryModels(input)

    // then
    expect(refreshed).toEqual({
      kind: "filtered",
      candidates: [{ model: "builtin/fallback", thinking: "minimal" }],
      rejected: [{ model: "extension-only/primary", cause: "model_not_visible" }],
    })
    expect(await Bun.file(probeLog).text()).toBe("probe\nprobe\n")
  })

  test("#given a changed config mtime #when preflight runs again #then it refreshes the child catalog", async () => {
    // given
    const item = await fixture(`
import { appendFileSync } from "node:fs"
appendFileSync(process.env.PROBE_LOG, "probe\\n")
process.stdout.write("builtin/fallback\\n")
`)
    const probeLog = join(item.root, "probes.log")
    const input = {
      candidates,
      launch: item.launch,
      env: { PATH: process.env.PATH, PROBE_LOG: probeLog },
      configSources: [{ path: item.config, exists: true }],
    }
    await preflightMemoryModels(input)
    const before = await stat(item.config)
    await writeFile(item.config, "{\n}\n", "utf8")
    await Bun.sleep(1)
    const after = await stat(item.config)
    if (after.mtimeMs === before.mtimeMs) await writeFile(item.config, "{\n  // changed\n}\n", "utf8")

    // when
    await preflightMemoryModels(input)

    // then
    expect((await Bun.file(probeLog).text()).trim().split("\n")).toHaveLength(2)
  })

  test("#given a launcher whose grandchild holds the output pipes #when the probe times out #then it degrades without waiting for the grandchild", async () => {
    // given: wrapper and grandchild park on a control socket owned by THIS test process, so both
    // die when that socket closes - through teardown or through this process dying outright.
    // The grandchild keeps holding the inherited output pipes even after the launcher itself is
    // killed, which is exactly the hazard the probe must degrade past.
    const item = await fixture("")
    const wrapper = join(item.root, "wrapper.mjs")
    const grandchildScript = join(item.root, "grandchild.mjs")
    const wrapperPidPath = join(item.root, "wrapper.pid")
    const grandchildPidPath = join(item.root, "grandchild.pid")
    const grandchildConnectedPath = join(item.root, "grandchild.connected")
    await writeFile(wrapper, `
import { spawn } from "node:child_process"
import { connect } from "node:net"
import { writeFileSync } from "node:fs"
writeFileSync(process.env.WRAPPER_PID_PATH, String(process.pid))
const child = spawn(process.execPath, [process.env.GRANDCHILD_SCRIPT], { stdio: ["ignore", "inherit", "inherit"] })
writeFileSync(process.env.GRANDCHILD_PID_PATH, String(child.pid))
const control = connect({ host: "127.0.0.1", port: Number(process.env.CONTROL_PORT) })
control.once("close", () => process.exit(0))
control.once("error", () => process.exit(0))
`, "utf8")
    await writeFile(grandchildScript, `
import { connect } from "node:net"
import { writeFileSync } from "node:fs"
writeFileSync(process.env.GRANDCHILD_PID_PATH, String(process.pid))
const control = connect({ host: "127.0.0.1", port: Number(process.env.CONTROL_PORT) })
control.once("connect", () => writeFileSync(process.env.GRANDCHILD_CONNECTED_PATH, "connected\\n"))
control.once("close", () => process.exit(0))
control.once("error", () => process.exit(0))
`, "utf8")
    const control = createServer()
    const connections = new Set<Socket>()
    control.on("connection", (socket) => connections.add(socket))
    await new Promise<void>((resolve, reject) => {
      control.once("error", reject)
      control.listen(0, "127.0.0.1", resolve)
    })
    const address = control.address()
    if (address === null || typeof address === "string") throw new Error("control listener has no tcp port")
    let grandchildIdentityForCleanup: import("./process-liveness.test-support").ProcessIdentity | null = null
    try {
      // The injected probe timeout doubles as the helpers' startup budget: both pid files must be
      // registered before the probe's SIGKILL lands, so the pipe-holding premise holds even on a
      // loaded or Windows runner (runtime boot costs far more than a tight budget would allow),
      // while an unbounded hang still blows past the outer wall-clock bound. Windows runners pay
      // far more to spawn process.execPath plus a grandchild, so the outer bound stays
      // platform-scoped.
      const probeTimeoutMs = 1_000
      const outerBoundMs = process.platform === "win32" ? 10_000 : 2_500
      const startedAt = Date.now()
      const probe = preflightMemoryModels({
        candidates,
        launch: { command: process.execPath, prefixArgs: [wrapper] },
        env: {
          PATH: process.env.PATH,
          CONTROL_PORT: String(address.port),
          WRAPPER_PID_PATH: wrapperPidPath,
          GRANDCHILD_PID_PATH: grandchildPidPath,
          GRANDCHILD_CONNECTED_PATH: grandchildConnectedPath,
          GRANDCHILD_SCRIPT: grandchildScript,
        },
        configSources: [{ path: item.config, exists: true }],
        timeoutMs: probeTimeoutMs,
      })

      // when
      const result = await Promise.race([
        probe,
        new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), outerBoundMs)),
      ])

      // then
      expect(result).toEqual({ kind: "unavailable", candidates })
      expect(Date.now() - startedAt).toBeLessThan(outerBoundMs)

      // and then: the ORIGINAL wrapper is observed through its own pid file - production must
      // have killed the launcher rather than merely abandoning it.
      const wrapperPid = await readPidFileWhenWritten(wrapperPidPath, HELPER_EXIT_BOUND_MS)
      expect(pidAlive(wrapperPid)).toBe(false)

      // and then (POSIX only): the grandchild outlives the killed launcher while still holding the
      // inherited pipes - the hazard this degradation is built for - and releasing the
      // parent-owned control channel takes that ORIGINAL grandchild down with it. Windows kills
      // the launcher's whole process tree (the same reason memory-run-supervisor's integration
      // suite tree-kills there instead of asserting survival), so the surviving-grandchild
      // premise cannot be staged on that platform at all.
      if (process.platform !== "win32") {
        const grandchildIdentity = await readPidWhenWritten(grandchildPidPath, HELPER_EXIT_BOUND_MS, "grandchild.mjs")
        grandchildIdentityForCleanup = grandchildIdentity
        expect(identityMatches(grandchildIdentity) && pidAlive(grandchildIdentity.pid)).toBe(true)
        // The grandchild writes its pid file BEFORE connect(); awaiting its explicit connected
        // marker guarantees the control snapshot below contains its socket on every runner.
        expect(await waitForFileToExist(grandchildConnectedPath, HELPER_EXIT_BOUND_MS)).toBe(true)
        const helperClosures = [...connections].map((socket) => new Promise<void>((resolve) => {
          if (socket.destroyed) return resolve()
          socket.once("close", () => resolve())
        }))
        closeControlChannel(control, connections)
        await Promise.all(helperClosures)
        expect(await pidTerminalWithin(grandchildIdentity, HELPER_EXIT_BOUND_MS)).toBe(true)
      }
    } finally {
      // Fail-safe: even when an assertion above failed - or when the win32 branch never captured an
      // identity at all - nothing this test spawned may survive it.
      closeControlChannel(control, connections)
      const leaked = grandchildIdentityForCleanup ?? await readPidOnce(grandchildPidPath, "grandchild.mjs")
      if (leaked !== null) {
        killIfAlive(leaked)
        await pidTerminalWithin(leaked, HELPER_FAILSAFE_BOUND_MS)
      }
    }
  }, 30_000)

  test("#given a failed child catalog probe #when candidates are preflighted #then it warns and preserves reactive fallback behavior", async () => {
    // given
    const item = await fixture('process.stderr.write("probe failed"); process.exit(7)')
    const warnings: string[] = []

    // when
    const result = await preflightMemoryModels({
      candidates,
      launch: item.launch,
      env: { PATH: process.env.PATH },
      configSources: [{ path: item.config, exists: true }],
      warn: (message, details) => warnings.push(`${message}: ${JSON.stringify(details)}`),
    })

    // then
    expect(result).toEqual({ kind: "unavailable", candidates })
    expect(warnings.join("\n")).toContain("exited with code 7")
  })

  test("#given a table catalog whose model column contains a slash #when candidates are preflighted #then the slashed model id stays visible", async () => {
    // given
    const item = await fixture(`process.stdout.write([
  "provider                    model                                                     context  max-out  thinking  images",
  "apitopia                    z-ai/glm-5.2-ultrafast-unlocked                           1M       131.1K   yes       no",
  "apitopia                    kimi-for-coding-highspeed                                 262.1K   65.5K    yes       yes",
].join("\\n") + "\\n")`)
    const slashed: MemoryModelChain = [
      { model: "apitopia/z-ai/glm-5.2-ultrafast-unlocked", thinking: "off" },
      { model: "apitopia/kimi-for-coding-highspeed" },
    ]

    // when
    const result = await preflightMemoryModels({
      candidates: slashed,
      launch: item.launch,
      env: { PATH: process.env.PATH },
      configSources: [{ path: item.config, exists: true }],
    })

    // then
    expect(result).toEqual({
      kind: "filtered",
      candidates: slashed,
      rejected: [],
    })
  })

  test("#given a table catalog row whose provider column contains a slash #when candidates are preflighted #then that malformed row is not treated as a visible model", async () => {
    // given
    const item = await fixture(`process.stdout.write([
  "provider                    model                                                     context",
  "bad/provider                some-model                                                1M",
  "apitopia                    z-ai/glm-5.2-ultrafast-unlocked                           1M",
].join("\\n") + "\\n")`)
    const mixed: MemoryModelChain = [
      { model: "bad/provider/some-model" },
      { model: "apitopia/z-ai/glm-5.2-ultrafast-unlocked" },
    ]

    // when
    const result = await preflightMemoryModels({
      candidates: mixed,
      launch: item.launch,
      env: { PATH: process.env.PATH },
      configSources: [{ path: item.config, exists: true }],
    })

    // then
    expect(result).toEqual({
      kind: "filtered",
      candidates: [{ model: "apitopia/z-ai/glm-5.2-ultrafast-unlocked" }],
      rejected: [{ model: "bad/provider/some-model", cause: "model_not_visible" }],
    })
  })

  test("#given a headerless catalog listing a slashed model id #when candidates are preflighted #then the slashed model id stays visible", async () => {
    // given
    const item = await fixture('process.stdout.write("apitopia/z-ai/glm-5.2-ultrafast-unlocked\\nbuiltin/fallback\\n")')
    const headerless: MemoryModelChain = [
      { model: "apitopia/z-ai/glm-5.2-ultrafast-unlocked" },
      { model: "builtin/fallback", thinking: "minimal" },
    ]

    // when
    const result = await preflightMemoryModels({
      candidates: headerless,
      launch: item.launch,
      env: { PATH: process.env.PATH },
      configSources: [{ path: item.config, exists: true }],
    })

    // then
    expect(result).toEqual({ kind: "filtered", candidates: headerless, rejected: [] })
  })

})
