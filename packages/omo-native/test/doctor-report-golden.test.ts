// Parity pins for `omo doctor` and `omo doctor --reap` on the npm launcher (#14959): the whole
// report, byte for byte, and the exit code, with every machine-dependent input injected. They are
// written against the code before the diagnostics move and must stay unmodified through it.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { asInstall, capture, createInstall, importInstalled, type Install } from "./doctor-golden.test-support"

type Entry = { pid: number; ppid: number; elapsed: string; tty: string; command: string }
type DoctorModule = {
  runDoctor(inventory: unknown, args: string[], options: Record<string, unknown>): void
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const NOW = Date.parse("2026-11-25T12:00:00.000Z")
const ENGINE = "/opt/omo/node_modules/@code-yeongyu/senpi/dist/bundle/cli.js"
const OLD_PAYLOAD = "/opt/omo-old/plugin"
const CREDENTIALED = { harnesses: [{ id: "senpi", installed: true, entryCount: 1 }] }
const SIBLING_ONLY = {
  harnesses: [
    { id: "senpi", installed: true, entryCount: 0 },
    { id: "claude-code", installed: true, entryCount: 2 },
  ],
}

const PROCESSES: Entry[] = [
  { pid: 12, ppid: 1, elapsed: "03:00", tty: "?", command: "/usr/sbin/sshd -D" },
  {
    pid: 13,
    ppid: 40,
    elapsed: "05:00",
    tty: "pts/3",
    command: `node ${ENGINE} --mode rpc --extension /opt/omo/plugin`,
  },
  { pid: 14, ppid: 99, elapsed: "07:00", tty: "pts/4", command: `node ${ENGINE} --extension /opt/omo/plugin` },
  { pid: 15, ppid: 1, elapsed: "1-02:03:04", tty: "pts/5", command: `node ${ENGINE} --extension ${OLD_PAYLOAD}` },
  { pid: 16, ppid: 1, elapsed: "09:00", tty: "pts/6", command: `node ${ENGINE} --extension /opt/omo/plugin` },
  { pid: 17, ppid: 1, elapsed: "2-00:00:00", tty: "?", command: "node /opt/legacy/senpi/dist/cli.js app-server" },
]

function baseOptions(install: Install): Record<string, unknown> {
  return {
    env: { PATH: install.emptyBin, HOME: install.home, OMO_MEMORY_HOME: install.memory },
    homeDir: install.home,
    platform: "linux",
    fetchDistTags: () => ({ beta: "1.2.4-test.0", latest: "1.2.2" }),
    list: () => [],
    now: () => NOW,
    payloadMtimeMs: () => undefined,
    keychainHelper: [],
    daemonReport: () => ["INFO Daemon: not running"],
    launchSpecIo: {
      platform: "linux",
      stat: () => {
        throw Object.assign(new Error("ENOENT: fixture"), { code: "ENOENT" })
      },
    },
  }
}

async function doctor(install: Install, inventory: unknown, args: string[], options: Record<string, unknown>) {
  const { runDoctor } = await importInstalled<DoctorModule>(install, "bin/lib/doctor.js")
  return asInstall(install, () => capture(install.root, () => runDoctor(inventory, args, options)))
}

describe("omo doctor golden (npm launcher)", () => {
  test("#given a healthy install #when doctor runs #then the report and exit code are exactly today's", async () => {
    const install = createInstall(roots)
    const result = await doctor(install, CREDENTIALED, [], baseOptions(install))
    expect(result).toEqual({
      stdout: [
        "PASS plugin manifest: plugin/package.json",
        "PASS extension: plugin/extensions/omo.js",
        "PASS lsp-daemon runtime: plugin/runtime/lsp-daemon/dist/cli.js",
        "PASS senpi CLI: <ROOT>/app/node_modules/@code-yeongyu/senpi/dist/cli.js",
        "PASS senpi version 2026.8.9",
        "INFO omo · Edition: Native · Installed: 1.2.3-test.0 (engine: senpi 2026.8.9) · Latest: 1.2.4-test.0",
        "INFO Update: npm i -g omo-ai@beta",
        "INFO config dir: <ROOT>/home/.omo/agent",
        "INFO Daemon: not running",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    })
  })

  test("#given a degraded install with stale, retired and live engines #when doctor runs #then every finding renders exactly as today and the exit code is 1", async () => {
    const install = createInstall(roots, { engineVersion: "2026.8.1", missing: ["plugin/extensions/omo.js"] })
    writeFileSync(join(install.agentDir, "settings.json"), JSON.stringify({ packages: ["@code-yeongyu/omo-senpi"] }))
    mkdirSync(join(install.memory, "agents", "durable", "repo"), { recursive: true })
    mkdirSync(join(install.memory, "agents", "scratch"), { recursive: true })
    mkdirSync(join(install.memory, "transient-runs", "run-1"), { recursive: true })
    const result = await doctor(install, SIBLING_ONLY, [], {
      ...baseOptions(install),
      fetchDistTags: () => {
        throw new Error("offline fixture")
      },
      list: () => PROCESSES,
      payloadMtimeMs: (dir: string) => (dir === OLD_PAYLOAD ? NOW - 60_000 : undefined),
      configDiagnostics: ["WARN config: <fixture>/omo.json: agents.x ignored (unknown agent)"],
      reflectionLock: ["WARN memory reflection is stuck on a stale lock (fixture)"],
      memoryRuntime: ["INFO memory runtime total: 1 KiB"],
      keychainHelper: ["WARN keychain helper: fixture"],
      computerUse: ["FAIL computer use engine: handshake-failed: fixture"],
      categoryCoverage: ["WARN task categories: 0 of 10 usable with your connected providers"],
    })
    expect(result).toEqual({
      stdout: [
        "PASS plugin manifest: plugin/package.json",
        "FAIL extension: missing plugin/extensions/omo.js",
        "PASS lsp-daemon runtime: plugin/runtime/lsp-daemon/dist/cli.js",
        "PASS senpi CLI: <ROOT>/app/node_modules/@code-yeongyu/senpi/dist/cli.js",
        "FAIL senpi version: expected 2026.8.9, found 2026.8.1",
        "INFO omo · Edition: Native · Installed: 1.2.3-test.0 (engine: senpi 2026.8.1) · Latest: could not check",
        "INFO Update: npm i -g omo-ai@beta",
        "WARN duplicate @code-yeongyu/omo-senpi package entry; remove it from the packages array because omo loads the packaged extension",
        "WARN config: <fixture>/omo.json: agents.x ignored (unknown agent)",
        "INFO config dir: <ROOT>/home/.omo/agent",
        "WARN stale engine pid 15 (age 1-02:03:04, tty pts/5) has no launcher; it was orphaned by a signaled launcher",
        "WARN stale engine pid 16 (age 09:00, tty pts/6) has no launcher; it was orphaned by a signaled launcher",
        "WARN stale engine pid 17 (age 2-00:00:00, tty ?) is an app-server daemon started by an older version; that command was removed, so stop it",
        "INFO reap them explicitly by pid: omo doctor --reap 15 16 17",
        "WARN engine pid 15 (age 1-02:03:04, tty pts/5) started before this payload was installed; it still runs the previous plugin copy",
        "INFO restart those sessions to pick up the installed payload; a running engine is never rewritten in place",
        "INFO memory identities: 1 durable, 1 transient (no repo/); transient run roots: 1",
        "WARN memory reflection is stuck on a stale lock (fixture)",
        "INFO memory runtime total: 1 KiB",
        "WARN keychain helper: fixture",
        "INFO Daemon: not running",
        "FAIL computer use engine: handshake-failed: fixture",
        "WARN task categories: 0 of 10 usable with your connected providers",
        "INFO no credentials found; run omo setup to review sibling stores",
      ].join("\n"),
      stderr: "",
      exitCode: 1,
    })
  })
})

describe("omo doctor --reap golden (npm launcher)", () => {
  test("#given no pids #when --reap runs #then it refuses with the usage line and exit code 1", async () => {
    const install = createInstall(roots)
    const kills: number[] = []
    const result = await doctor(install, CREDENTIALED, ["--reap"], {
      list: () => PROCESSES,
      kill: (pid: number) => kills.push(pid),
    })
    expect({ ...result, kills }).toEqual({
      stdout: "FAIL --reap needs the pids to terminate: omo doctor --reap <pid> [pid...]",
      stderr: "",
      exitCode: 1,
      kills: [],
    })
  })

  test("#given every refusal and two stale engines, one that cannot be signalled #when --reap runs #then each pid gets today's line, only stale engines are signalled, exit code 1", async () => {
    const install = createInstall(roots)
    const kills: [number, string][] = []
    const result = await doctor(install, CREDENTIALED, ["--reap", "abc", "0", "12", "13", "14", "15", "16", "404"], {
      list: () => PROCESSES,
      kill: (pid: number, signal: string) => {
        kills.push([pid, signal])
        if (pid === 16) throw new Error("EPERM: fixture")
      },
    })
    expect({ ...result, kills }).toEqual({
      stdout: [
        'FAIL refusing "abc": --reap takes process ids',
        'FAIL refusing "0": --reap takes process ids',
        "FAIL refusing pid 12: it is not an omo engine process",
        "FAIL refusing pid 13: it is a managed engine (--mode), owned by whatever started it",
        "FAIL refusing pid 14: its launcher (pid 99) is alive, so it is a live session",
        "PASS reaped stale engine pid 15 (age 1-02:03:04, tty pts/5)",
        "FAIL could not signal pid 16: EPERM: fixture",
        "FAIL refusing pid 404: it is not an omo engine process",
      ].join("\n"),
      stderr: "",
      exitCode: 1,
      kills: [
        [15, "SIGTERM"],
        [16, "SIGTERM"],
      ],
    })
  })

  test("#given only stale engines #when --reap runs #then both are signalled with SIGTERM and the exit code is 0", async () => {
    const install = createInstall(roots)
    const kills: [number, string][] = []
    const result = await doctor(install, CREDENTIALED, ["--reap", "15", "17"], {
      list: () => PROCESSES,
      kill: (pid: number, signal: string) => kills.push([pid, signal]),
    })
    expect({ ...result, kills }).toEqual({
      stdout: [
        "PASS reaped stale engine pid 15 (age 1-02:03:04, tty pts/5)",
        "PASS reaped stale engine pid 17 (age 2-00:00:00, tty ?)",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
      kills: [
        [15, "SIGTERM"],
        [17, "SIGTERM"],
      ],
    })
  })
})
