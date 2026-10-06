import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join, relative, resolve } from "node:path"
import { spawnSync } from "node:child_process"

import { daemonDirectoryName } from "@code-yeongyu/senpi"
import { runStatus as runProductionStatus } from "../bin/lib/daemon-operations.js"
import { resolveSenpi } from "../bin/lib/package-paths.js"

const PACKAGE_ROOT = resolve(import.meta.dir, "..")
const LAUNCHER = join(PACKAGE_ROOT, "bin", "omo.js")
// The tracked source of the launch spec; `build:omo-native` copies it into this package's untracked plugin/.
const LAUNCH_SPEC = resolve(PACKAGE_ROOT, "..", "omo-senpi", "plugin", "daemon-launch-spec.json")
const roots: string[] = []
const ownedPids = new Set<number>()
// Headroom over any single status spawn, so the observing reads land inside the idle window on a loaded runner.
const OBSERVED_IDLE_EXIT_MS = 8_000
const REQUIRED_REACHABLE_READS = 2

setDefaultTimeout(30_000)

afterEach(() => {
  for (const pid of ownedPids) killOwned(pid)
  ownedPids.clear()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function sandbox() {
  const agentDir = mkdtempSync("/tmp/dh41.")
  roots.push(agentDir)
  const socket = join(agentDir, "rpc", "shards", "p-aaaaaaaaaaaaaaaa.sock")
  expect(Buffer.byteLength(`${socket}.next-99`)).toBeLessThanOrEqual(103)
  mkdirSync(join(agentDir, "rpc", "shards"), { recursive: true })
  const env = {
    ...process.env,
    OMO_RUNTIME: "node",
    OMO_CODING_AGENT_DIR: agentDir,
    SENPI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_DIR: agentDir,
  }
  return { agentDir, socket, env }
}

function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(command, [...args], { encoding: "utf8", env, timeout: 15_000 })
  if (result.error !== undefined) throw result.error
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
}

function ensureShard(socket: string, env: NodeJS.ProcessEnv) {
  const result = run("node", [
    resolveSenpi().cliPath,
    "host",
    "ensure",
    "--json",
    "--socket",
    socket,
    "--launch-spec",
    LAUNCH_SPEC,
    "--policy",
    "upgrade",
  ], env)
  expect(result.exitCode).toBe(0)
  const payload = JSON.parse(result.stdout) as { pid: number }
  ownedPids.add(payload.pid)
  return payload.pid
}

function runStatus(env: NodeJS.ProcessEnv) {
  return run("node", [LAUNCHER, "daemon", "status", "--json"], env)
}

function statusSawReachableShard(env: NodeJS.ProcessEnv): boolean {
  const payload = JSON.parse(runStatus(env).stdout) as { endpoints: readonly { reachable: boolean }[] }
  return payload.endpoints.some((endpoint) => endpoint.reachable)
}

function childPidOf(parentPid: number): number {
  const output = spawnSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" }).stdout
  const child = output
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .find((match) => match !== null && Number(match[2]) === parentPid && match[3].includes("rpc"))
  if (child === undefined || child === null) throw new Error(`host child of ${parentPid} not found`)
  return Number(child[1])
}

function killShardUncleanly(supervisorPid: number): void {
  const childPid = childPidOf(supervisorPid)
  ownedPids.add(childPid)
  process.kill(supervisorPid, "SIGSTOP")
  process.kill(childPid, "SIGKILL")
  process.kill(supervisorPid, "SIGKILL")
  waitForExit(childPid)
  waitForExit(supervisorPid)
  ownedPids.delete(childPid)
  ownedPids.delete(supervisorPid)
}

function waitForExit(pid: number): void {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  }
  throw new Error(`pid ${pid} did not exit`)
}

function killOwned(pid: number): void {
  try {
    process.kill(pid, "SIGKILL")
  } catch {
    return
  }
  waitForExit(pid)
}

function snapshotState(agentDir: string): string {
  const hash = createHash("sha256")
  for (const root of [join(agentDir, "rpc-host-daemon"), join(agentDir, "rpc", "shards")]) {
    hash.update(relative(agentDir, root))
    walk(root, root, hash)
  }
  return hash.digest("hex")
}

function walk(root: string, path: string, hash: ReturnType<typeof createHash>): void {
  let stat
  try {
    stat = lstatSync(path)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      hash.update(`${relative(root, path)}:missing`)
      return
    }
    throw error
  }
  const name = relative(root, path) || "."
  if (stat.isDirectory()) {
    hash.update(`${name}:dir`)
    for (const entry of readdirSync(path).toSorted()) walk(root, join(path, entry), hash)
    return
  }
  if (stat.isFile()) {
    hash.update(`${name}:file:`).update(readFileSync(path))
    return
  }
  hash.update(`${name}:${stat.isSocket() ? "socket" : "other"}`)
}

async function assertReadOnlyState(agentDir: string, action: () => void | Promise<void>): Promise<void> {
  const before = snapshotState(agentDir)
  await action()
  const after = snapshotState(agentDir)
  if (after !== before) throw new Error(`daemon status changed state: ${before} -> ${after}`)
}

if (process.platform !== "win32") {
  describe("omo daemon real-engine read-only and observe contracts", () => {
    test("#given an uncleanly killed shard #when status json runs #then every daemon and shard state byte stays identical", async () => {
      const { agentDir, socket, env } = sandbox()
      const supervisorPid = ensureShard(socket, env)
      killShardUncleanly(supervisorPid)
      const endpointDir = join(agentDir, "rpc-host-daemon", daemonDirectoryName(socket))
      const pointer = join(endpointDir, "host.pid")
      const settings = join(endpointDir, "settings.json")
      const generations = join(endpointDir, "generations")
      expect(readFileSync(pointer, "utf8")).toContain("generation_dir")
      expect(readFileSync(settings, "utf8")).toContain("idleExitMs")
      const generationDirs = readdirSync(generations)
      expect(generationDirs.length).toBeGreaterThan(0)
      for (const generation of generationDirs) {
        expect(readFileSync(join(generations, generation, "host.pid"), "utf8")).toContain("pid")
        expect(readFileSync(join(generations, generation, "settings.json"), "utf8")).toContain("idleExitMs")
      }

      await assertReadOnlyState(agentDir, () => {
        const status = runStatus(env)
        expect(status.exitCode).toBe(3)
        const payload = JSON.parse(status.stdout) as { endpoints: readonly { reachable: boolean }[] }
        expect(payload.endpoints.some((endpoint) => endpoint.reachable === false)).toBe(true)
      })
    })

    test("#given production status with a write mutant #when the read-only guard runs #then production turns red", async () => {
      const { agentDir } = sandbox()
      mkdirSync(join(agentDir, "rpc-host-daemon"), { recursive: true })

      await expect(assertReadOnlyState(agentDir, () => {
        runProductionStatus({
          engine: {
            run: () => ({ exitCode: 3, stdout: JSON.stringify({ endpoints: [] }), stderr: "" }),
          },
          agentDir,
          env: {},
          json: true,
          stdout: { write() {} },
          stderr: { write() {} },
          _test: {
            afterRead: () => {
              writeFileSync(join(agentDir, "rpc-host-daemon", "status-was-here"), "mutant\n")
            },
          },
        })
      })).rejects.toThrow("daemon status changed state")
    })

    test("#given a short idle shard #when status reads keep arriving #then observing reads do not keep it alive", () => {
      const { socket, env } = sandbox()
      const supervisorPid = ensureShard(socket, {
        ...env,
        SENPI_RPC_HOST_IDLE_EXIT_MS: String(OBSERVED_IDLE_EXIT_MS),
      })

      let reachableReads = 0
      while (reachableReads < REQUIRED_REACHABLE_READS) {
        if (!pidAlive(supervisorPid)) {
          throw new Error(`shard exited after ${reachableReads} of ${REQUIRED_REACHABLE_READS} status reads that saw it reachable`)
        }
        if (statusSawReachableShard(env)) reachableReads += 1
      }

      // The supervisor is detached by `host ensure`, so there is no exit event to await: it is watched by pid.
      // The backoff between reads only limits spawn load on a busy runner; it is not a timing assertion, and the
      // reads keep arriving well inside the idle window.
      const exitDeadline = Date.now() + OBSERVED_IDLE_EXIT_MS * 3
      let readsAwaitingExit = 0
      let backoffMs = 100
      while (pidAlive(supervisorPid)) {
        if (Date.now() > exitDeadline) {
          throw new Error(`shard pid ${supervisorPid} still alive after ${readsAwaitingExit} more status reads; observing reads must not reset its idle timer`)
        }
        runStatus(env)
        readsAwaitingExit += 1
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(backoffMs, Math.max(0, exitDeadline - Date.now())))
        backoffMs = Math.min(backoffMs * 2, 500)
      }

      expect(reachableReads).toBe(REQUIRED_REACHABLE_READS)
      ownedPids.delete(supervisorPid)
    }, OBSERVED_IDLE_EXIT_MS * 6)
  })
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
