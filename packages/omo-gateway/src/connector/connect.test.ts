import { afterEach, describe, expect, test } from "bun:test"
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spoolLine } from "./fixtures/spool-adapter"
import { LineCollector } from "./fixtures/wait"
import { connectorLogPath } from "./ensure"
import { connectorLockPath, connectorsDir, readConnectorLock } from "./lock"

const ENTRY = join(import.meta.dir, "fixtures", "connect-entry.ts")
const ADAPTER = join(import.meta.dir, "fixtures", "spool-adapter.ts")
const TARGET = ["--scope", "qa", "--surface", "slack", "--adapter-module", ADAPTER]
const FOREGROUND = [...TARGET, "--sink", "stdout"]
const TEST_TIMEOUT = 240_000

type Rig = { root: string; agent: string; creds: string; spool: string; env: Record<string, string> }
const rigs: Rig[] = []
const started = new Set<number>()

afterEach(async () => {
  for (const pid of started) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {}
  }
  started.clear()
  for (const at of rigs.splice(0)) {
    const lock = await readConnectorLock(connectorLockPath(at.agent, "slack", "T000TEST"))
    if (lock?.live === true && lock.record.pid !== process.pid) {
      try {
        process.kill(lock.record.pid, "SIGKILL")
      } catch {}
    }
    rmSync(at.root, { recursive: true, force: true })
  }
})

function rig(): Rig {
  const root = mkdtempSync(join(tmpdir(), "omo-gateway-connect-"))
  const agent = join(root, "agent")
  mkdirSync(connectorsDir(agent), { recursive: true, mode: 0o700 })
  const creds = join(root, "creds.json")
  writeFileSync(creds, '{"token":"dummy"}', { mode: 0o600 })
  const spool = join(root, "spool.jsonl")
  writeFileSync(spool, "")
  const section = { scopes: [{ id: "qa", surfaces: [{ platform: "slack", account_id: "T000TEST", credentials_file: creds }] }] }
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "",
    HOME: root,
    OMO_GATEWAY_TEST_SECTION: JSON.stringify(section),
    OMO_GATEWAY_TEST_AGENT_DIR: agent,
    OMO_GATEWAY_QA_SPOOL: spool,
  }
  const made = { root, agent, creds, spool, env }
  rigs.push(made)
  return made
}

function connect(at: Rig, args: readonly string[]) {
  const child = Bun.spawn([process.execPath, ENTRY, ...args], { env: at.env, stdout: "pipe", stderr: "pipe" })
  started.add(child.pid)
  return { child, out: new LineCollector(child.stdout), err: new LineCollector(child.stderr) }
}

function inject(at: Rig, event_id: string): void {
  appendFileSync(at.spool, spoolLine({ event_id, chat_id: "C000TEST", thread_id: null, text: `hello ${event_id}`, at: new Date().toISOString() }))
}

const isEvent = (line: string): boolean => line.startsWith("GATEWAY_EVENT ")
const eventId = (line: string): string => JSON.parse(line.slice("GATEWAY_EVENT ".length)).event.event_id
const lockPath = (at: Rig) => connectorLockPath(at.agent, "slack", "T000TEST")

type Run = ReturnType<typeof connect>

async function holding(run: Run): Promise<number> {
  const [line] = await run.err.waitFor((entry) => entry.includes("holding the lock (pid "), 1, "lock held")
  return Number(/holding the lock \(pid (\d+)\)/.exec(line ?? "")?.[1])
}

function handedOff(run: Run, id: string): Promise<string[]> {
  return run.err.waitFor((line) => line.endsWith(`: handed off ${id}`), 1, `${id} committed`)
}

async function stoppedCleanly(at: Rig): Promise<void> {
  const tail = Bun.spawn(["tail", "-n", "+1", "-F", connectorLogPath(at.agent, "slack", "T000TEST")], { stdout: "pipe", stderr: "ignore" })
  started.add(tail.pid)
  try {
    await new LineCollector(tail.stdout).waitFor((line) => line.startsWith("gateway connector slack-T000TEST: stopped after"), 1, "the stop line")
  } finally {
    tail.kill()
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe("omo gateway connect (subprocess)", () => {
  test("#given a running connector #when a second connect runs #then it attaches, exits 0 and prints the holder pid; SIGTERM cleans up", async () => {
    // given
    const at = rig()
    const holder = connect(at, FOREGROUND)
    const pid = await holding(holder)

    // when
    const second = connect(at, FOREGROUND)
    const secondExit = await second.child.exited
    await second.out.ended
    holder.child.kill("SIGTERM")
    const holderExit = await holder.child.exited

    // then
    expect(pid).toBe(holder.child.pid)
    expect(secondExit).toBe(0)
    expect(second.out.lines.some((line) => line.startsWith(`attached: connector slack-T000TEST is held by pid ${pid} `))).toBe(true)
    expect(holderExit).toBe(0)
    expect(alive(pid)).toBe(false)
    expect(existsSync(lockPath(at))).toBe(false)
  }, TEST_TIMEOUT)

  test("#given repeated kill -9 between messages and one sent while down #when connect restarts each time #then every message is one line", async () => {
    // given
    const at = rig()
    const lines: string[] = []
    let deadPid: number | null = null

    // when: three cycles of start -> message -> kill -9, with one more message while nothing runs
    for (const id of ["e1", "e2", "e3"]) {
      const run = connect(at, FOREGROUND)
      const pid = await holding(run)
      if (deadPid !== null) await run.err.waitFor((line) => line.includes(`took over a dead lock from pid ${deadPid}`), 1, "takeover notice")
      inject(at, id)
      await run.out.waitFor((line) => isEvent(line) && eventId(line) === id, 1, `${id} line`)
      await handedOff(run, id)
      run.child.kill("SIGKILL")
      await run.child.exited
      await run.out.ended
      lines.push(...run.out.lines.filter(isEvent))
      deadPid = pid
    }
    inject(at, "e4")
    const last = connect(at, FOREGROUND)
    await last.out.waitFor((line) => isEvent(line) && eventId(line) === "e4", 1, "e4 line from catch-up")
    inject(at, "e5")
    await last.out.waitFor((line) => isEvent(line) && eventId(line) === "e5", 1, "e5 live line")
    last.child.kill("SIGTERM")
    const lastExit = await last.child.exited
    await last.out.ended
    lines.push(...last.out.lines.filter(isEvent))

    // then
    expect(lines.map(eventId)).toEqual(["e1", "e2", "e3", "e4", "e5"])
    expect(lastExit).toBe(0)
    expect(readdirSync(connectorsDir(at.agent)).filter((name) => name.endsWith(".tmp"))).toEqual([])
    const tails = Bun.spawnSync(["pgrep", "-f", `[t]ail -c .* -F ${at.spool}`]).stdout.toString().trim()
    expect(tails).toBe("")
    expect(existsSync(lockPath(at))).toBe(false)
  }, TEST_TIMEOUT)

  test("#given two detached connects racing #when both ensure #then one connector runs and both report its pid", async () => {
    // given
    const at = rig()

    // when
    const [a, b] = [connect(at, TARGET), connect(at, TARGET)]
    const exits = await Promise.all([a.child.exited, b.child.exited])
    await Promise.all([a.out.ended, b.out.ended])
    const lock = await readConnectorLock(lockPath(at))
    const pid = lock?.live === true ? lock.record.pid : -1

    // then
    expect(exits).toEqual([0, 0])
    const reports = [...a.out.lines, ...b.out.lines].filter((line) => line !== "")
    expect(reports.filter((line) => line.startsWith("started connector slack-T000TEST"))).toHaveLength(1)
    for (const line of reports) expect(line).toContain(`pid ${pid}`)
    process.kill(pid, "SIGTERM")
    await stoppedCleanly(at)
    expect(existsSync(lockPath(at))).toBe(false)
  }, TEST_TIMEOUT)

  test("#given a group-readable credentials file #when connect runs #then it exits 2 with the 0600 refusal and takes no lock", async () => {
    // given
    const at = rig()
    chmodSync(at.creds, 0o644)

    // when
    const run = connect(at, FOREGROUND)
    const exit = await run.child.exited
    await run.err.ended

    // then
    expect(exit).toBe(2)
    expect(run.err.lines).toContain("omo gateway connect: credentials must be 0600: ~/creds.json is 0644")
    expect(existsSync(lockPath(at))).toBe(false)
  }, TEST_TIMEOUT)
})
