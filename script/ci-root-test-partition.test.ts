import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { ROOT_TEST_SERIAL_QUARANTINE_PATHS, serialQuarantineCommand } from "./root-test-serial-quarantine.ts"

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
const posixShard2 = readFileSync(new URL("../.github/scripts/ci-root-shard-2.sh", import.meta.url), "utf8")
const windowsTelemetryScript = readFileSync(
  new URL("../.github/scripts/windows-ci-telemetry.ps1", import.meta.url),
  "utf8",
)
const rootConfig = readFileSync(new URL("../bunfig.root.toml", import.meta.url), "utf8")
const win2ConfigPath = new URL("../bunfig.win2.toml", import.meta.url)
const win2ParallelConfigPath = new URL("../bunfig.win2.parallel.toml", import.meta.url)
const win2WindowsParallelConfigPath = new URL("../bunfig.win2.parallel.windows.toml", import.meta.url)
const win2WindowsRestConfigPath = new URL("../bunfig.win2.parallel.windows-rest.toml", import.meta.url)
const win2RestConfigPath = new URL("../bunfig.win2.parallel.rest.toml", import.meta.url)
const shard2RemainderConfigPaths = [
  win2ParallelConfigPath,
  win2WindowsParallelConfigPath,
  win2WindowsRestConfigPath,
  win2RestConfigPath,
]
const macosShard1bConfigPath = new URL("../bunfig.root-shard-1b.toml", import.meta.url)

function quarantinedTestPaths(config: string): readonly string[] {
  return [...config.matchAll(/"([^"]+\.test\.ts)"/g)].map((match) => match[1] ?? "")
}

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function linuxTestJobs(): string {
  const start = workflow.indexOf("  test-linux:\n")
  const end = workflow.indexOf("\n  macos-combined-1:", start)
  if (start < 0 || end < 0) throw new Error("Linux root test jobs not found")
  return workflow.slice(start, end)
}

function workflowSlice(from: string, to: string): string {
  const start = workflow.indexOf(`  ${from}:\n`)
  const end = workflow.indexOf(`\n  ${to}:`, start)
  if (start < 0 || end < 0) throw new Error(`${from} job not found`)
  return workflow.slice(start, end)
}

const windowsShard1Job = () => workflowSlice("test-windows-1", "windows-test-1-status")
const windowsShard1StatusJob = () => workflowSlice("windows-test-1-status", "typecheck")
const windowsShard2Job = () => workflowSlice("test-windows-2", "windows-test-2-status")
const windowsShard2StatusJob = () => workflowSlice("windows-test-2-status", "test-linux")
const senpiCompatibilityJob = () => workflowSlice("senpi-tests-windows", "windows-senpi-status")

interface TestBunfig {
  readonly preload: unknown
  readonly pathIgnorePatterns: readonly string[]
  readonly loader: unknown
}

function testBunfig(path: URL): TestBunfig {
  const parsed: unknown = Bun.TOML.parse(readFileSync(path, "utf8"))
  if (typeof parsed !== "object" || parsed === null) throw new Error(`${path.pathname} is not a TOML table`)
  const test: unknown = Reflect.get(parsed, "test")
  if (typeof test !== "object" || test === null) throw new Error(`${path.pathname} has no [test] table`)
  const patterns: unknown = Reflect.get(test, "pathIgnorePatterns")
  if (!Array.isArray(patterns) || !patterns.every((pattern) => typeof pattern === "string")) {
    throw new Error(`${path.pathname} has no string test.pathIgnorePatterns`)
  }
  return { preload: Reflect.get(test, "preload"), pathIgnorePatterns: patterns, loader: Reflect.get(parsed, "loader") }
}

// The directories the macOS shard-1a step passes to `bun test` (#14849), read from its ci.yml command.
function macosShard1aTrees(): readonly string[] {
  const run = /id: root-tests-posix-1a\n[\s\S]*?\n {10}bun test --timeout 20000 ([^\n]*?) --reporter=/.exec(
    workflow,
  )?.[1]
  if (run === undefined) throw new Error("macOS shard 1a step not found")
  return run.split(" ")
}

function quotedPatterns(config: string): readonly string[] {
  return [...config.matchAll(/"([^"]+\/\*\*)"/g)].map((match) => match[1] ?? "")
}

function assertWindowsTelemetryContract(script: string): void {
  if (
    !script.includes("$postTestUtc") ||
    !script.includes("$postTestStopwatchTimestamp") ||
    !script.includes("postTest =")
  ) {
    throw new Error("windows telemetry contract: missing post-test capture")
  }
}

describe("root test CI partition", () => {
  test("#given required status check names #when the root matrix is declared #then only os and shard appear", () => {
    for (const [status, parts, shard] of [
      [windowsShard1StatusJob(), "test-windows-1", "1/2"],
      [windowsShard2StatusJob(), "test-windows-2", "2/2"],
    ]) {
      const matrix = status.slice(status.indexOf("include:"), status.indexOf("steps:"))
      expect(status).toContain(
        `name: test\n    needs: [ci-mode, ${parts}]\n    if: \${{ always() && !cancelled() }}\n    runs-on: ubuntu-26.04`,
      )
      expect(matrix).toBe(`include:\n          - os: windows-latest\n            shard: "${shard}"\n    `)
    }

    const linux = linuxTestJobs()
    expect(linux).toContain("name: test\n    needs: [ci-mode, test-linux]")
    expect(linux).toContain('- os: ubuntu-latest\n            shard: "1/2"')
    expect(linux).toContain('- os: ubuntu-latest\n            shard: "2/2"')
    expect(linux).toContain("LEG_JOB_STATUS: ${{ needs.test-linux.result }}")
  })

  test("#given global zauc mocks #when Windows root tests are partitioned #then omo-opencode stays in one process", () => {
    const job = windowsShard2Job()

    expect(windowsShard1Job()).toContain(
      '-TestArguments @("--config=bunfig.root-shard-1b.toml", "test", "packages/omo-opencode", "packages/memory-core")',
    )
    expect(linuxTestJobs()).toContain("run: bun test --timeout 20000 packages/omo-opencode\n")
    expect(job).toContain(
      '-TestArguments @("--config=bunfig.win2.parallel.windows.toml", "test", "--parallel", "./script", "./packages/senpi-task")',
    )
    expect(job).toContain('-TestArguments @("--config=bunfig.win2.parallel.windows-rest.toml", "test", "--parallel")')
    expect(existsSync(win2WindowsRestConfigPath)).toBe(true)
    expect(existsSync(win2ConfigPath)).toBe(true)
    expect(existsSync(win2ParallelConfigPath)).toBe(true)
    expect(existsSync(win2WindowsParallelConfigPath)).toBe(true)
    expect(existsSync(win2RestConfigPath)).toBe(true)
    expect(quotedPatterns(readFileSync(win2ConfigPath, "utf8"))).toContain("packages/omo-opencode/**")
    expect(quotedPatterns(readFileSync(win2ConfigPath, "utf8"))).toContain("packages/memory-core/**")
  })

  test("#given the shared quarantine module #when a parallel leg is rendered #then its serial command lists exactly those files", () => {
    const job = windowsShard2Job()
    const serialCommand = serialQuarantineCommand()

    expect(ROOT_TEST_SERIAL_QUARANTINE_PATHS.length).toBeGreaterThan(0)
    expect([...posixShard2.matchAll(new RegExp(escapeForRegExp(serialCommand), "g"))]).toHaveLength(1)
    for (const testPath of ROOT_TEST_SERIAL_QUARANTINE_PATHS) {
      expect([...(job + posixShard2).matchAll(new RegExp(escapeForRegExp(testPath), "g"))]).toHaveLength(2)
    }
  })

  test("#given the shared quarantine module #when the shard-2 bunfigs are read #then each ignores exactly the quarantined files", () => {
    for (const configPath of shard2RemainderConfigPaths) {
      expect(existsSync(configPath)).toBe(true)

      expect(quarantinedTestPaths(readFileSync(configPath, "utf8"))).toEqual([...ROOT_TEST_SERIAL_QUARANTINE_PATHS])
    }
  })

  test("#given the macOS shard-2 light and Windows shard-2b bunfigs #when read #then each is its remainder minus the other half's trees", () => {
    for (const [half, remainder, trees] of [
      [win2RestConfigPath, win2ParallelConfigPath, ["script/**"]],
      [win2WindowsRestConfigPath, win2WindowsParallelConfigPath, ["script/**", "packages/senpi-task/**"]],
    ] as const) {
      const { pathIgnorePatterns, ...settings } = testBunfig(half)
      const { pathIgnorePatterns: base, ...baseSettings } = testBunfig(remainder)
      expect({ pathIgnorePatterns, ...settings }).toEqual({ pathIgnorePatterns: [...base, ...trees], ...baseSettings })
    }
  })

  test("#given the macOS shard-1b bunfig #when it is read #then it is bunfig.toml plus exactly the shard-1a trees", () => {
    const root = testBunfig(new URL("../bunfig.toml", import.meta.url))
    const shard1b = testBunfig(macosShard1bConfigPath)
    const trees = macosShard1aTrees()

    expect(trees.length).toBeGreaterThan(0)
    expect(shard1b.pathIgnorePatterns).toEqual([
      ...root.pathIgnorePatterns,
      ...trees.map((tree) => `${tree.replace(/\/+$/, "")}/**`),
    ])
    expect(shard1b.preload).toEqual(root.preload)
    expect(shard1b.loader).toEqual(root.loader)
  })

  test("#given the shard-2 remainder bunfigs #when a shard-2 leg runs the remainder #then each keeps every bunfig.root.toml exclusion", () => {
    for (const configPath of shard2RemainderConfigPaths) {
      const parallelPatterns = quotedPatterns(readFileSync(configPath, "utf8"))

      for (const pattern of quotedPatterns(rootConfig)) {
        expect(parallelPatterns).toContain(pattern)
      }
    }
  })

  test("#given the Linux root parts #when root tests run #then the quarantine and both remainder halves run serially", () => {
    const linux = linuxTestJobs()

    // POSIX shard 2 runs the remainder serially. `bun test --parallel` is not
    // used on POSIX: --isolate re-ran the heavy preload per file across ~1,550
    // files and OOM-killed the 7 GB ubuntu runner at ~8 min with every test
    // passing, and --no-isolate leaked module state between files
    // (category-routing, coordinator guard, boulder-state failures). Job-level
    // sharding is the parallelism; each shard is one serial process, the shape
    // this suite passed with for years.
    expect(linux).toContain("part: [omo-opencode, memory-core, remainder-1, remainder-2]")
    expect(linux).toContain("bash .github/scripts/ci-root-shard-2.sh quarantine")
    expect(linux).toContain(
      "if: matrix.part == 'remainder-1'\n        run: bash .github/scripts/ci-root-shard-2.sh first",
    )
    expect(linux).toContain(
      "if: matrix.part == 'remainder-2'\n        run: bash .github/scripts/ci-root-shard-2.sh second",
    )
    expect(linux).toContain(
      "unshare -Upf --mount-proc --map-current-user -- env CI=1 bun test --timeout 20000 packages/memory-core",
    )
    expect(posixShard2).toContain(serialQuarantineCommand())
    for (const [mode, shard] of [
      ["first", "1/2"],
      ["second", "2/2"],
    ]) {
      expect(posixShard2).toContain(
        `if [ "$mode" = "${mode}" ]; then\n  bun --config=bunfig.win2.parallel.toml test --timeout 20000 --shard=${shard} --timings=.omo/ci-shard-record.json --update-timings $(junit root-2-${mode})\nfi`,
      )
    }
    expect(posixShard2).toContain(
      'if [ "$mode" = "all" ]; then\n  bun --config=bunfig.win2.parallel.toml test --timeout 20000 $(junit root-2-remainder)\nfi',
    )
    expect(posixShard2).not.toContain("bun --config=bunfig.win2.parallel.toml test --parallel")
  })

  test("#given the dedicated Senpi compatibility job #when root tests run #then omo-senpi is excluded on every OS", () => {
    expect(quotedPatterns(rootConfig)).toContain("packages/omo-senpi/**")
    expect(quotedPatterns(readFileSync(win2ParallelConfigPath, "utf8"))).toContain("packages/omo-senpi/**")
    expect(quotedPatterns(readFileSync(win2ConfigPath, "utf8"))).toContain("packages/omo-senpi/**")
  })

  test("#given global zauc mocks #when Linux parts are sharded #then only the remainder uses native file sharding", () => {
    const job = windowsShard2Job()

    expect(job).not.toContain("--shard=")
    expect(linuxTestJobs()).not.toContain("--shard=")
    expect(posixShard2.match(/--shard=/g)).toHaveLength(2)
    expect(job).not.toContain("--path-ignore-patterns=")
    expect(job).not.toContain("format('-c {0}'")
    expect(job).not.toContain("bun test -c")
  })

  test("#given Windows hook tests read process platform #when root tests run #then bun is not launched under Git Bash", () => {
    for (const job of [windowsShard1Job(), windowsShard2Job()]) {
      for (const part of ["a", "b"]) {
        expect(job).toMatch(
          new RegExp(
            `id: root-tests-windows-[12]${part}\\n        if: matrix.part == '${part}'\\n        shell: pwsh\\n`,
          ),
        )
      }
      expect(job).not.toContain("shell: bash\n        run: |")
      expect(job).toContain("    timeout-minutes: 60\n")
    }
  })

  test("#given a telemetry fixture without post-test state #when the contract is checked #then the diagnostic is stable", () => {
    const missingPostTestCapture = `
      $preTestUtc = [DateTime]::UtcNow.ToString("o")
      $preTestStopwatchTimestamp = [System.Diagnostics.Stopwatch]::GetTimestamp()
      exit $testExitCode
    `

    expect(() => assertWindowsTelemetryContract(missingPostTestCapture)).toThrow(
      "windows telemetry contract: missing post-test capture",
    )
  })

  test("#given Windows root-test telemetry #when the collector runs #then timing and process state avoid secrets", () => {
    assertWindowsTelemetryContract(windowsTelemetryScript)
    expect(windowsTelemetryScript).toContain("$preTestUtc")
    expect(windowsTelemetryScript).toContain("$preTestStopwatchTimestamp")
    expect(windowsTelemetryScript).toContain("stopwatchFrequency")
    expect(windowsTelemetryScript).toContain("-OperationTimeoutSec 5")
    expect(windowsTelemetryScript).toContain("[string]$postTestStopwatchTimestamp")
    expect(windowsTelemetryScript).toContain("name =")
    expect(windowsTelemetryScript).toContain("pid =")
    expect(windowsTelemetryScript).toContain("parentPid =")
    expect(windowsTelemetryScript).toContain("creationTimeUtc =")
    expect(windowsTelemetryScript).toContain("temporaryPaths =")
    expect(windowsTelemetryScript).toContain("testExitCode = $testExitCode")
    expect(windowsTelemetryScript).toContain("survivingDescendants =")
    expect(windowsTelemetryScript).not.toContain("CommandLine")
    expect(windowsTelemetryScript).not.toContain("ExecutablePath")
    expect(windowsTelemetryScript).not.toContain("Get-ChildItem Env:")
  })

  test("#given Windows test failures #when telemetry completes #then the Bun exit code remains authoritative", () => {
    expect(windowsTelemetryScript).toContain("$testExitCode = $testProcess.ExitCode")
    expect(windowsTelemetryScript).toContain("exit $testExitCode")
    expect(windowsTelemetryScript).toContain("Write-Warning")
    expect(windowsTelemetryScript).not.toContain("exit 0")
  })

  test("#given both Windows shards #when root tests run #then telemetry wraps every Bun invocation", () => {
    const job = windowsShard2Job()

    expect([...job.matchAll(/& \.github\/scripts\/windows-ci-telemetry\.ps1/g)]).toHaveLength(4)
    expect([...windowsShard1Job().matchAll(/& \.github\/scripts\/windows-ci-telemetry\.ps1/g)]).toHaveLength(2)
    expect(windowsShard1Job()).toContain('-Invocation "shard-1a" `\n            -TimingRecord `')
    expect(windowsShard1Job()).toContain('-Invocation "shard-1b" `\n            -TimingRecord `')
    for (const invocation of ["shard-2-rpc-host", "shard-2a", "shard-2-quarantine", "shard-2b"]) {
      expect(job).toContain(`-Invocation "${invocation}" \`\n            -TimingRecord \``)
    }
    expect(job).toContain("WINDOWS_TEST_SHARD: 2/2")
  })

  test("#given Windows Senpi compatibility tests #when the package gate runs #then telemetry wraps the flaky test invocation", () => {
    const job = senpiCompatibilityJob()
    const windowsStepName = "      - name: Run Senpi compatibility tests with Windows telemetry"
    const windowsStepStart = job.indexOf(windowsStepName)

    expect(windowsStepStart, "Windows Senpi compatibility tests must be telemetry-wrapped").toBeGreaterThanOrEqual(0)

    const windowsStep = job.slice(
      windowsStepStart,
      job.indexOf("      - name: Upload Windows Senpi telemetry", windowsStepStart),
    )
    const uploadStep = job.slice(
      job.indexOf("      - name: Upload Windows Senpi telemetry"),
      job.indexOf("      - name: Write job summary"),
    )

    expect(job).toContain("runs-on: windows-latest")
    expect(windowsStep).toContain("shell: pwsh")
    expect([...windowsStep.matchAll(/& \.github\/scripts\/windows-ci-telemetry\.ps1/g)]).toHaveLength(4)
    for (const invocation of ["senpi-one", "senpi-two", "senpi-three-worker", "senpi-three-rest"]) {
      expect(windowsStep).toContain(`-Invocation "${invocation}" \`\n              -TimingRecord \``)
    }
    expect(windowsStep).toContain("exit $LASTEXITCODE")
    const stepBudget = Number(/^        timeout-minutes: (\d+)$/m.exec(windowsStep)?.[1])
    const jobBudget = Number(/^    timeout-minutes: (\d+)$/m.exec(job)?.[1])
    expect(stepBudget, "#11815: the hang-prone Windows step needs its own budget").toBeGreaterThan(0)
    expect(
      jobBudget,
      "#11815: the senpi-compatibility job needs a budget below GitHub's 360-minute default",
    ).toBeGreaterThan(0)
    expect(stepBudget, "#11815: the step budget must leave room for the job's install and build steps").toBeLessThan(
      jobBudget,
    )
    expect(uploadStep).toContain("if: always()")
    expect(uploadStep).toContain("continue-on-error: true")
    expect(uploadStep).toContain("uses: actions/upload-artifact@v6")
  })

  test("#given Windows telemetry files #when a matrix leg finishes #then immutable artifacts always upload without gating", () => {
    const job = windowsShard2Job()
    const uploadStep = job.slice(
      job.indexOf("      - name: Upload Windows post-test telemetry"),
      job.indexOf("      - name: Upload Windows shard record"),
    )

    expect(uploadStep).toContain("if: always()\n")
    expect(uploadStep).toContain("continue-on-error: true")
    expect(uploadStep).toContain("uses: actions/upload-artifact@v6")
    expect(uploadStep).toContain("${{ github.run_id }}-${{ github.run_attempt }}")
    expect(uploadStep).toContain("if-no-files-found: warn")
    expect(uploadStep).toContain("overwrite: false")
  })

  test("#given Windows cache restore costs more than install #when the Windows root jobs run #then they never restore Bun cache", () => {
    for (const job of [windowsShard1Job(), windowsShard2Job()]) {
      expect(job).toContain("      - name: Install dependencies")
      expect(job).not.toContain("actions/cache")
    }
  })
})
