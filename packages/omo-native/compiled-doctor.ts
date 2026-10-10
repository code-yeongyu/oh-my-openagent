import { existsSync } from "node:fs"
import { join } from "node:path"
import { canonicalAgentDir } from "./bin/lib/agent-dir.js"
import { doctorCoverageLines } from "./bin/lib/category-coverage.js"
import { doctorComputerUseLines } from "./bin/lib/computer-use-doctor.js"
import { daemonReportLines } from "./bin/lib/daemon.js"
import { reapStaleEngines, staleEngineReport, transientMemoryReport, warningsForSettings } from "./bin/lib/doctor.js"
import { migrationReport } from "./bin/lib/doctor-migration.js"
import { piConfigReport } from "./bin/lib/doctor-pi-config.js"
import { launchSpecDoctorLines } from "./bin/lib/launch-spec-mode.js"
import { needsSetupSuggestion, type detectHarnesses } from "./bin/lib/setup-detect.js"
import { compiledDiagnosticRuntimeLoader, loadCompiledCoverageEngine } from "./compiled-diagnostic-runtime"
import { configDoctorLines } from "./config-doctor-runtime"
import { claudeCodeDoctorLines } from "./claude-code-doctor"

type DaemonEngine = { run(args: string[], options: { env: Record<string, string | undefined> }): { exitCode: number; stdout: string; stderr: string } }

export type CompiledDoctorOptions = {
  readonly env?: NodeJS.ProcessEnv
  readonly homeDir?: string
  readonly platform?: NodeJS.Platform
  readonly coverageLines?: () => Promise<string[]>
  readonly computerUseLines?: () => Promise<string[]>
  readonly list?: () => { pid: number; ppid: number; elapsed: string; tty: string; command: string }[]
  readonly kill?: (pid: number, signal: NodeJS.Signals) => void
}

const doctorArtifacts = [
  ["plugin manifest", "plugin/package.json"],
  ["extension", "plugin/extensions/omo.js"],
  ["lsp-daemon runtime", "plugin/runtime/lsp-daemon/dist/cli.js"],
] as const

export type CompiledDoctorInput = {
  readonly inventory: Awaited<ReturnType<typeof detectHarnesses>>
  readonly execDir: string
  readonly version: string
  readonly versionText: string
  readonly updateCommand: string
  readonly engine?: DaemonEngine
  readonly args?: readonly string[]
  readonly options?: CompiledDoctorOptions
}

function computerUseLines(input: CompiledDoctorInput, env: NodeJS.ProcessEnv): Promise<string[]> {
  if (input.options?.computerUseLines) return input.options.computerUseLines()
  return doctorComputerUseLines({
    loadRuntime: compiledDiagnosticRuntimeLoader(input.execDir),
    packageRoot: input.execDir,
    version: input.version,
    env: { ...env, OMO_PACKAGE_DIR: env.OMO_PACKAGE_DIR ?? input.execDir },
  })
}

function coverageLines(input: CompiledDoctorInput, env: NodeJS.ProcessEnv): Promise<string[]> {
  if (input.options?.coverageLines) return input.options.coverageLines()
  return doctorCoverageLines({
    agentDir: canonicalAgentDir(env),
    env,
    loadRuntime: compiledDiagnosticRuntimeLoader(input.execDir),
    loadEngine: loadCompiledCoverageEngine,
  })
}

export async function runCompiledDoctor(input: CompiledDoctorInput): Promise<void> {
  const options = input.options ?? {}
  if (input.args?.[0] === "--reap") {
    const result = reapStaleEngines(input.args.slice(1), options)
    console.log(result.lines.join("\n"))
    process.exitCode = result.failed ? 1 : 0
    return
  }
  const env = options.env ?? process.env
  let failed = false
  const lines: string[] = []
  for (const [label, artifact] of doctorArtifacts) {
    if (existsSync(join(input.execDir, artifact))) lines.push(`PASS ${label}: ${artifact}`)
    else {
      lines.push(`FAIL ${label}: missing ${artifact}`)
      failed = true
    }
  }
  for (const line of input.versionText.split("\n")) lines.push(`INFO ${line}`)
  lines.push(`INFO Update: ${input.updateCommand}`)
  const launchSpec = launchSpecDoctorLines(join(input.execDir, "plugin"))
  if (launchSpec.some((line) => line.startsWith("FAIL "))) failed = true
  lines.push(...launchSpec)
  if (input.engine !== undefined) {
    lines.push(...daemonReportLines({ engine: input.engine, pluginRoot: join(input.execDir, "plugin"), agentDir: canonicalAgentDir(), env: process.env, platform: process.platform }))
  }
  lines.push(...migrationReport({ ...options, standalone: true }, null))
  lines.push(...warningsForSettings())
  lines.push(...configDoctorLines({ cwd: process.cwd(), env }))
  lines.push(...piConfigReport({ env: options.env, homeDir: options.homeDir }))
  lines.push(...staleEngineReport(options))
  lines.push(...transientMemoryReport({ env }))
  const [computerUse, coverage] = await Promise.all([computerUseLines(input, env), coverageLines(input, env)])
  if (computerUse.some((line) => line.startsWith("FAIL "))) failed = true
  lines.push(...computerUse, ...claudeCodeDoctorLines({ runtimeDir: input.execDir, env }), ...coverage)
  if (needsSetupSuggestion(input.inventory)) lines.push("INFO no credentials found; run omo setup to review sibling stores")
  console.log(lines.join("\n"))
  process.exitCode = failed ? 1 : 0
}
