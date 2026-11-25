import { afterEach, describe, expect, test } from "bun:test"
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { assembleOmoSdk } from "../../omo-senpi/src/components/omo-sdk/assembly"
import { renderFindings } from "../bin/lib/diagnostics-findings.js"
import type { DaemonEngine, RunPorts } from "../bin/lib/diagnostics-contract"
import { printDoctorReport, runDoctor } from "../bin/lib/doctor.js"
import { createDiagnosticsLoader } from "../diagnostics-loader"
import { asInstall, capture, createInstall, importInstalled, normalize } from "./doctor-golden.test-support"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// One engine answering `host status --all --json` with a running daemon and one task host: the daemon/host section is
// built from it, so the SDK answer and the command's report both carry it or both miss it.
const HOSTS = JSON.stringify({
  endpoints: [
    { socket: "/run/omo/rpc.sock", reachable: true, pid: 4100, engineVersion: "2026.8.9", sessions: { total: 2 } },
    { socket: "/run/omo/p-abc.sock", shard: { kind: "p", key: "abc" }, reachable: false },
  ],
})

function ports(home: string): RunPorts {
  const engine: DaemonEngine = { run: () => ({ exitCode: 0, stdout: `${HOSTS}\n`, stderr: "" }) }
  return {
    env: { HOME: home, PATH: join(home, "bin"), OMO_MEMORY_HOME: join(home, "memory") },
    homeDir: home,
    platform: "linux",
    inventory: { harnesses: [{ id: "senpi", installed: true, entryCount: 1 }] },
    fetchDistTags: () => ({ beta: "1.0.0", latest: "1.0.0" }),
    list: () => [],
    now: () => Date.parse("2026-11-25T12:00:00.000Z"),
    payloadMtimeMs: () => undefined,
    daemonEngine: engine,
    keychainHelper: () => [],
    configDiagnostics: async () => [],
    reflectionLock: async () => [],
    memoryRuntime: async () => [],
    computerUse: async () => [],
    categoryCoverage: async () => [],
  }
}

describe("diagnostics.run through the SDK root against omo doctor", () => {
  test("#given the same ports and a daemon engine with hosts #when the root answers run and the command prints its report #then the rendered findings are the printed report, daemon and host findings included", async () => {
    const home = mkdtempSync(join(tmpdir(), "omo-root-report-"))
    roots.push(home)
    const given = ports(home)
    const root = assembleOmoSdk(
      { env: given.env ?? {}, cwd: home, home },
      { cores: { diagnostics: createDiagnosticsLoader(given) } },
    )
    const answer = await root.diagnostics.run({})
    if (answer.kind !== "ok") throw new Error(`run answered ${JSON.stringify(answer)}`)
    const printed = await capture(home, async () => {
      process.exitCode = await printDoctorReport(given)
    })
    expect(answer.value.findings.filter((finding) => finding.check === "daemon").length).toBeGreaterThan(1)
    expect(normalize(renderFindings(answer.value.findings).join("\n"), home)).toBe(printed.stdout)
    expect(printed.exitCode).toBe(answer.value.failed ? 1 : 0)
  })

  test("#given a pid beyond a safe integer and an orphaned engine #when omo doctor --reap runs #then the number gets the not-an-engine line in its place, the engine is still reaped and the exit is 1", async () => {
    const signalled: number[] = []
    const engine = {
      pid: 11,
      ppid: 1,
      elapsed: "05:00",
      tty: "pts/1",
      command: "node /opt/omo/node_modules/@code-yeongyu/senpi/dist/bundle/cli.js",
    }
    const printed = await capture(tmpdir(), () =>
      runDoctor({ harnesses: [] }, ["--reap", "99999999999999999999", "11"], {
        list: () => [engine],
        kill: (pid: number) => void signalled.push(pid),
      }),
    )
    expect(printed).toEqual({
      stdout: [
        "FAIL refusing pid 100000000000000000000: it is not an omo engine process",
        "PASS reaped stale engine pid 11 (age 05:00, tty pts/1)",
      ].join("\n"),
      stderr: "",
      exitCode: 1,
    })
    expect(signalled).toEqual([11])
  })

  test("#given an installed engine whose host CLI reports a running daemon and neither caller passes an engine #when the root answers run and the command prints its report #then both carry the daemon and host findings from that CLI", async () => {
    const install = createInstall(roots)
    const engineCli = join(install.packageRoot, "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js")
    writeFileSync(engineCli, `process.stdout.write(${JSON.stringify(`${HOSTS}\n`)})\n`)
    copyFileSync(
      join(import.meta.dir, "..", "diagnostics-loader.ts"),
      join(install.packageRoot, "diagnostics-loader.ts"),
    )
    const { createDiagnosticsLoader: installedLoader } = await importInstalled<{
      createDiagnosticsLoader: typeof createDiagnosticsLoader
    }>(install, "diagnostics-loader.ts")
    const { printDoctorReport: installedReport } = await importInstalled<{
      printDoctorReport: typeof printDoctorReport
    }>(install, "bin/lib/doctor.js")
    const { daemonEngine: _none, ...withoutEngine } = ports(install.home)
    const env = { ...withoutEngine.env, OMO_CODING_AGENT_DIR: install.agentDir }
    const given = { ...withoutEngine, env }
    const root = assembleOmoSdk(
      { env, cwd: install.root, home: install.home },
      { cores: { diagnostics: installedLoader(given) } },
    )
    const answer = await asInstall(install, () => root.diagnostics.run({}))
    if (answer.kind !== "ok") throw new Error(`run answered ${JSON.stringify(answer)}`)
    const daemon = answer.value.findings
      .filter((finding) => finding.check === "daemon")
      .map((finding) => finding.message)
    expect(daemon).toContain(
      "Hosts: 1 live (0 shards, 0 threads) · 2 session(s) · rss 0 MB (host 0 MB) · crashes 0 (recorded, newest 50 per endpoint)",
    )
    const printed = await asInstall(install, () =>
      capture(install.root, async () => {
        process.exitCode = await installedReport(given)
      }),
    )
    expect(normalize(renderFindings(answer.value.findings).join("\n"), install.root)).toBe(printed.stdout)
  })
})
