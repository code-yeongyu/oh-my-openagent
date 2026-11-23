import { expect } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"

import { resolveSenpi } from "../bin/lib/package-paths.js"
import { createDaemonTestRunner, signalTarget } from "./daemon-test-runner"

const PACKAGE_ROOT = resolve(import.meta.dir, "..")
const LAUNCHER = join(PACKAGE_ROOT, "bin", "omo.js")
// The tracked source of the launch spec; `build:omo-native` copies it into this package's untracked plugin/.
const LAUNCH_SPEC = resolve(PACKAGE_ROOT, "..", "omo-senpi", "plugin", "daemon-launch-spec.json")

export function createDaemonEngineHarness() {
  const roots: string[] = []
  const ownedPids = new Set<number>()
  const { run, killChildren } = createDaemonTestRunner()

  function sandbox() {
    const agentDir = mkdtempSync("/tmp/dh41.")
    roots.push(agentDir)
    const socket = join(agentDir, "rpc", "shards", "p-aaaaaaaaaaaaaaaa.sock")
    expect(Buffer.byteLength(`${socket}.next-99`)).toBeLessThanOrEqual(103)
    // The engine refuses an agent dir any group or other user can write (unsafe_key_record), as a real ~/.omo/agent never
    // is; mkdirSync otherwise takes the process umask, so on a host with umask 002 every shard here failed to start.
    mkdirSync(join(agentDir, "rpc", "shards"), { recursive: true, mode: 0o700 })
    const env = {
      ...process.env,
      TMPDIR: agentDir,
      TEMP: agentDir,
      TMP: agentDir,
      OMO_RUNTIME: "node",
      OMO_CODING_AGENT_DIR: agentDir,
      SENPI_CODING_AGENT_DIR: agentDir,
      PI_CODING_AGENT_DIR: agentDir,
      // The idle contracts this file observes need a transient shard. A runner whose own host is pinned
      // (omo daemon run --pinned) leaks SENPI_RPC_HOST_COLD_START=persistent into every child, and a
      // persistent shard never idle-exits: the observing-reads case then dies at its exit deadline
      // ("shard pid still alive after N more status reads"). Pin the transient default here; each
      // case's SENPI_RPC_HOST_IDLE_EXIT_MS override stays where it is observed.
      SENPI_RPC_HOST_COLD_START: "transient",
    }
    return { agentDir, socket, env }
  }

  async function ensureShard(socket: string, env: NodeJS.ProcessEnv) {
    const result = await run(
      "node",
      [
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
      ],
      env,
    )
    // On a refusal the engine names its reason (e.g. unsafe_key_record) in the ensure output; the assertion carries it.
    expect(result.exitCode, `host ensure failed: ${result.stdout}${result.stderr}`).toBe(0)
    const payload = JSON.parse(result.stdout) as { pid: number }
    ownedPids.add(payload.pid)
    return payload.pid
  }

  function runStatus(env: NodeJS.ProcessEnv) {
    return run("node", [LAUNCHER, "daemon", "status", "--json"], env)
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
    process.kill(signalTarget(supervisorPid, "the shard supervisor"), "SIGSTOP")
    process.kill(signalTarget(childPid, "the shard host child"), "SIGKILL")
    process.kill(signalTarget(supervisorPid, "the shard supervisor"), "SIGKILL")
    waitForExit(childPid)
    waitForExit(supervisorPid)
    ownedPids.delete(childPid)
    ownedPids.delete(supervisorPid)
  }

  function forgetShard(pid: number): void {
    ownedPids.delete(pid)
  }

  // Every step runs even when an earlier one fails, so one stuck pid never leaves the others or the sandbox behind;
  // the failures are reported together at the end.
  function cleanup(): void {
    const failures: unknown[] = []
    const attempt = (step: () => void): void => {
      try {
        step()
      } catch (error) {
        failures.push(error)
      }
    }
    attempt(killChildren)
    for (const pid of ownedPids) attempt(() => killOwned(pid))
    ownedPids.clear()
    // A shard supervisor the engine detached into its own process group before `host ensure` answered (a bound
    // tripped mid-start) never reached ownedPids; it still carries its sandbox in its environment.
    for (const root of roots)
      attempt(() => {
        for (const pid of pidsWithAgentDir(root)) attempt(() => killOwned(pid))
      })
    for (const root of roots.splice(0)) attempt(() => rmSync(root, { recursive: true, force: true }))
    if (failures.length > 0) throw new AggregateError(failures, "daemon harness cleanup failed")
  }

  return { sandbox, ensureShard, runStatus, killShardUncleanly, forgetShard, cleanup }
}

// A zombie has exited: only its parent (or an init that may never get to it in a container) can reap it, and signal 0
// still reaches it, so it counts as gone.
export function waitForExit(pid: number): void {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (exited(pid)) return
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  }
  throw new Error(`pid ${pid} did not exit`)
}

function exited(pid: number): boolean {
  const target = signalTarget(pid, "a process to wait for")
  try {
    process.kill(target, 0)
  } catch {
    return true
  }
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
      return stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z")
    } catch {
      return true
    }
  }
  return spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" })
    .stdout.trim()
    .startsWith("Z")
}

function pidsWithAgentDir(root: string): number[] {
  const marker = `OMO_CODING_AGENT_DIR=${root}`
  if (process.platform === "linux") {
    return readdirSync("/proc")
      .filter((entry) => /^\d+$/.test(entry) && Number(entry) !== process.pid)
      .filter((entry) => {
        try {
          return readFileSync(`/proc/${entry}/environ`, "utf8").split("\0").includes(marker)
        } catch {
          return false
        }
      })
      .map(Number)
  }
  // With every environment shown the listing runs to megabytes; spawnSync's default 1 MiB buffer would cut it short
  // and silently drop the later (newest) processes, which are exactly the ones a test just started.
  const listed = spawnSync("ps", ["-axwwE", "-o", "pid=,command="], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
  if (listed.status !== 0 || listed.error !== undefined)
    throw new Error(`ps failed listing processes: ${String(listed.error ?? listed.stderr)}`)
  const listing = listed.stdout
  return listing
    .split("\n")
    .filter((line) => line.split(/\s+/).includes(marker))
    .map((line) => Number(line.trim().split(/\s+/)[0]))
    .filter((pid) => pid !== process.pid)
}

function killOwned(pid: number): void {
  const target = signalTarget(pid, "a sandbox-owned process")
  try {
    process.kill(target, "SIGKILL")
  } catch {
    return
  }
  waitForExit(pid)
}
