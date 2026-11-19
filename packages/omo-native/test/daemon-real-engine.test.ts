import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { createHash } from "node:crypto"
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { type ChildProcess, spawn, spawnSync } from "node:child_process"

import { daemonDirectoryName } from "@code-yeongyu/senpi"
import { runStatus as runProductionStatus } from "../bin/lib/daemon-operations.js"
import { resolveSenpi } from "../bin/lib/package-paths.js"

const PACKAGE_ROOT = resolve(import.meta.dir, "..")
const LAUNCHER = join(PACKAGE_ROOT, "bin", "omo.js")
// The tracked source of the launch spec; `build:omo-native` copies it into this package's untracked plugin/.
const LAUNCH_SPEC = resolve(PACKAGE_ROOT, "..", "omo-senpi", "plugin", "daemon-launch-spec.json")
const roots: string[] = []
const ownedPids = new Set<number>()
const runningChildren = new Set<ChildProcess>()
// Headroom over any single status spawn, so the observing reads land inside the idle window on a loaded runner.
const OBSERVED_IDLE_EXIT_MS = 8_000
const REQUIRED_REACHABLE_READS = 2
const IDLE_TEST_BUDGET_MS = OBSERVED_IDLE_EXIT_MS * 6

// #11845: a starved-but-working child must not die at a wall-clock deadline. A cold daemon start on a
// CPU-starved shard container legitimately needs multiples of its quiet-box wall time, and the CLI spends
// its whole life blocked in spawnSync while the daemon tree does the work — so the only honest progress
// signal is CPU time of the child's whole descendant tree. Kill on CPU stall, bound the runaway, and let
// bun's test timeout sit above both.
const STALL_KILL_MS = 10_000
const RUNAWAY_CAP_MS = 120_000
const PROGRESS_SAMPLE_MS = 250
// Two scheduler quanta: less than this between samples is scheduling noise, not work.
const PROGRESS_EPSILON_S = 0.02
setDefaultTimeout(RUNAWAY_CAP_MS + 5_000)
class SpawnBudgetError extends Error {
  override name = "SpawnBudgetError"
}

// Linux: sum utime+stime+cutime+cstime over the /proc subtree rooted at the child. The CLI's own utime
// stays flat while it blocks on the daemon, so sampling the tree is what separates slow from stalled.
// macOS: ps gives the same graph once per sample. CLK_TCK is 100 on every host we run on.
function childTreeCpuSeconds(rootPid: number): number {
  if (process.platform === "linux") {
    try {
      const ppidOf = new Map<number, number>()
      const cpuOf = new Map<number, number>()
      for (const entry of readdirSync("/proc")) {
        if (!/^\d+$/.test(entry)) continue
        let stat: string
        try {
          stat = readFileSync(`/proc/${entry}/stat`, "utf8")
        } catch {
          continue
        }
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
        ppidOf.set(Number(entry), Number(fields[1]))
        cpuOf.set(
          Number(entry),
          (Number(fields[11]) + Number(fields[12]) + Number(fields[13]) + Number(fields[14])) / 100,
        )
      }
      let total = 0
      const walk = (pid: number): void => {
        const cpu = cpuOf.get(pid)
        if (cpu === undefined) return
        total += cpu
        for (const [childPid, parentPid] of ppidOf) if (parentPid === pid) walk(childPid)
      }
      walk(rootPid)
      return total
    } catch {
      return -1
    }
  }
  const listing = spawnSync("ps", ["-axo", "pid=,ppid=,cputime="], { encoding: "utf8" })
  if (listing.status !== 0) return -1
  const ppidOf = new Map<number, number>()
  const cpuOf = new Map<number, number>()
  for (const line of listing.stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
    if (!match) continue
    const parts = match[3].split(":")
    let seconds = 0
    for (const part of parts) {
      const [days, rest] = part.split("-")
      if (rest !== undefined) seconds += Number.parseInt(days, 10) * 86_400
      seconds = seconds * 60 + Number.parseFloat(rest ?? days)
    }
    ppidOf.set(Number(match[1]), Number(match[2]))
    cpuOf.set(Number(match[1]), seconds)
  }
  let total = 0
  const walk = (pid: number): void => {
    const cpu = cpuOf.get(pid)
    if (cpu === undefined) return
    total += cpu
    for (const [childPid, parentPid] of ppidOf) if (parentPid === pid) walk(childPid)
  }
  walk(rootPid)
  return total
}

afterEach(() => {
  for (const child of runningChildren) child.kill("SIGKILL")
  runningChildren.clear()
  for (const pid of ownedPids) killOwned(pid)
  ownedPids.clear()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

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

// A cold `node` start on a loaded host can take longer than any fixed per-spawn budget (#9679), so each child
// runs until it closes. The bounds are progress-shaped (#11845): a child whose descendant tree stops making
// CPU progress for stallMs is killed as stalled; a child that keeps making progress is bounded only by the
// runaway cap. Both rejections name the command and its output.
function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv, options: { stallMs?: number } = {}) {
  const stallMs = options.stallMs ?? STALL_KILL_MS
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(command, [...args], { env, stdio: ["ignore", "pipe", "pipe"] })
    runningChildren.add(child)
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk
    })
    let settled = false
    const settle = (finish: () => void): void => {
      if (settled) return
      settled = true
      clearInterval(sampler)
      clearTimeout(capTimer)
      finish()
    }
    const capTimer = setTimeout(() => {
      child.kill("SIGKILL")
      settle(() =>
        reject(
          new SpawnBudgetError(
            `${command} ${args.join(" ")} exceeded the ${RUNAWAY_CAP_MS}ms runaway cap while still making CPU progress\nstdout: ${stdout}\nstderr: ${stderr}`,
          ),
        ),
      )
    }, RUNAWAY_CAP_MS)
    let lastCpu = -1
    let lastAdvance = Date.now()
    const sampler = setInterval(() => {
      if (child.pid === undefined) return
      const cpu = childTreeCpuSeconds(child.pid)
      if (cpu < 0) return
      if (cpu >= lastCpu + PROGRESS_EPSILON_S) {
        lastCpu = cpu
        lastAdvance = Date.now()
        return
      }
      if (Date.now() - lastAdvance >= stallMs) {
        child.kill("SIGKILL")
        const stalledFor = Math.round((Date.now() - lastAdvance) / 1000)
        settle(() =>
          reject(
            new SpawnBudgetError(
              `${command} ${args.join(" ")} made no CPU progress for ${stalledFor}s (tree cpu ${cpu.toFixed(2)}s): stalled, not slow\nstdout: ${stdout}\nstderr: ${stderr}`,
            ),
          ),
        )
      }
    }, PROGRESS_SAMPLE_MS)
    child.on("error", (error) => {
      settle(() => {
        runningChildren.delete(child)
        reject(error)
      })
    })
    child.on("close", (code) => {
      settle(() => {
        runningChildren.delete(child)
        resolvePromise({ exitCode: code ?? 1, stdout, stderr })
      })
    })
  })
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

async function statusSawReachableShard(env: NodeJS.ProcessEnv): Promise<boolean> {
  const payload = JSON.parse((await runStatus(env)).stdout) as { endpoints: readonly { reachable: boolean }[] }
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
      const supervisorPid = await ensureShard(socket, env)
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

      await assertReadOnlyState(agentDir, async () => {
        const status = await runStatus(env)
        expect(status.exitCode).toBe(3)
        const payload = JSON.parse(status.stdout) as { endpoints: readonly { reachable: boolean }[] }
        expect(payload.endpoints.some((endpoint) => endpoint.reachable === false)).toBe(true)
      })
    })

    test("#given production status with a write mutant #when the read-only guard runs #then production turns red", async () => {
      const { agentDir } = sandbox()
      mkdirSync(join(agentDir, "rpc-host-daemon"), { recursive: true })

      await expect(
        assertReadOnlyState(agentDir, () => {
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
        }),
      ).rejects.toThrow("daemon status changed state")
    })

    test(
      "#given a short idle shard #when status reads keep arriving #then observing reads do not keep it alive",
      async () => {
        const { socket, env } = sandbox()
        const supervisorPid = await ensureShard(socket, {
          ...env,
          SENPI_RPC_HOST_IDLE_EXIT_MS: String(OBSERVED_IDLE_EXIT_MS),
        })

        let reachableReads = 0
        while (reachableReads < REQUIRED_REACHABLE_READS) {
          if (!pidAlive(supervisorPid)) {
            throw new Error(
              `shard exited after ${reachableReads} of ${REQUIRED_REACHABLE_READS} status reads that saw it reachable`,
            )
          }
          if (await statusSawReachableShard(env)) reachableReads += 1
        }

        // The supervisor is detached by `host ensure`, so there is no exit event to await: it is watched by pid.
        // The backoff between reads only limits spawn load on a busy runner; it is not a timing assertion, and the
        // reads keep arriving well inside the idle window.
        const exitDeadline = Date.now() + OBSERVED_IDLE_EXIT_MS * 3
        let readsAwaitingExit = 0
        let backoffMs = 100
        while (pidAlive(supervisorPid)) {
          if (Date.now() > exitDeadline) {
            throw new Error(
              `shard pid ${supervisorPid} still alive after ${readsAwaitingExit} more status reads; observing reads must not reset its idle timer`,
            )
          }
          await runStatus(env)
          readsAwaitingExit += 1
          Atomics.wait(
            new Int32Array(new SharedArrayBuffer(4)),
            0,
            0,
            Math.min(backoffMs, Math.max(0, exitDeadline - Date.now())),
          )
          backoffMs = Math.min(backoffMs * 2, 500)
        }

        expect(reachableReads).toBe(REQUIRED_REACHABLE_READS)
        ownedPids.delete(supervisorPid)
      },
      IDLE_TEST_BUDGET_MS,
    )

    describe("omo daemon real-engine spawn budget progress semantics", () => {
      test("#given a child that stalls with no CPU work #when it stops advancing #then it is killed as stalled, not slow", async () => {
        const started = Date.now()
        let rejection: unknown
        try {
          // Sleeps 60s: alive, but its tree burns no CPU after boot.
          await run("node", ["-e", "setTimeout(() => {}, 60000)"], process.env, { stallMs: 1_500 })
        } catch (error) {
          rejection = error
        }
        expect(rejection).toBeInstanceOf(SpawnBudgetError)
        const elapsed = Date.now() - started
        expect(elapsed).toBeLessThan(20_000)
        expect(String(rejection)).toContain("stalled, not slow")
      })

      test("#given a child that keeps making CPU progress #when the stall window keeps elapsing #then it still exits on its own", async () => {
        // Solid CPU for 4s: far past the stall window, far under the runaway cap. The old wall-clock
        // deadline (or a fixed 30s test budget on a starved runner) is what this child used to lose to.
        const result = await run("node", ["-e", "const t=Date.now()+4000;while(Date.now()<t){}"], process.env, {
          stallMs: 1_500,
        })
        expect(result.exitCode).toBe(0)
      })
    })
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
