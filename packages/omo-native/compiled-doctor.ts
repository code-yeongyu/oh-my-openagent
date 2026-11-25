import { adoptedEngineTrust } from "@code-yeongyu/senpi/engine-trust"
import { createRequire } from "node:module"
import { join } from "node:path"
import { canonicalAgentDir } from "./bin/lib/agent-dir.js"
import { doctorCoverageLines } from "./bin/lib/category-coverage.js"
import { doctorComputerUseLines } from "./bin/lib/computer-use-doctor.js"
import { keychainHelperDoctorLines } from "./bin/lib/keychain-helper-doctor.js"
import { printDoctorFix, printDoctorReap, printDoctorReport } from "./bin/lib/doctor.js"
import { TASK_CONFIG_RUNTIME } from "./bin/lib/daemon-config.js"
import {
  memoryRuntimeDiscardResolver,
  memoryRuntimeMaxBytesResolver,
  memoryRuntimeReport,
} from "./bin/lib/doctor-memory-runtime.js"
import { runDoctorModels } from "./bin/lib/model-chains.js"
import type { detectHarnesses } from "./bin/lib/setup-detect.js"
import { compiledDiagnosticRuntimeLoader, loadCompiledCoverageEngine } from "./compiled-diagnostic-runtime"
import { configDoctorLines } from "./config-doctor-runtime"
import { claudeCodeDoctorLines } from "./claude-code-doctor"
import { engineTrustDoctorLines, readEngineTrustRecords } from "./engine-trust-doctor"

type DaemonEngine = {
  run(
    args: string[],
    options: { env: Record<string, string | undefined> },
  ): { exitCode: number; stdout: string; stderr: string }
}

export type CompiledDoctorOptions = {
  readonly env?: NodeJS.ProcessEnv
  readonly homeDir?: string
  readonly platform?: NodeJS.Platform
  readonly coverageLines?: () => Promise<string[]>
  readonly computerUseLines?: () => Promise<string[]>
  readonly keychainHelperLines?: () => string[]
  readonly trustLines?: () => Promise<string[]>
  readonly memoryRuntimeLines?: () => Promise<string[]>
  readonly list?: () => { pid: number; ppid: number; elapsed: string; tty: string; command: string }[]
  readonly kill?: (pid: number, signal: NodeJS.Signals) => void
}

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

/** Design revision 11: the adopted generation's default-file outcome, INFO only, from the trust log beside it. */
async function trustLines(options: CompiledDoctorOptions): Promise<string[]> {
  if (options.trustLines) return options.trustLines()
  const marker = adoptedEngineTrust()
  return engineTrustDoctorLines({ platform: process.platform, marker, records: await readEngineTrustRecords(marker) })
}

/** The memory-runtime section the npm launcher's doctor prints (bin/lib/launcher.js), from the same report. */
async function memoryRuntimeLines(input: CompiledDoctorInput, env: NodeJS.ProcessEnv): Promise<string[]> {
  try {
    if (input.options?.memoryRuntimeLines) return await input.options.memoryRuntimeLines()
    const pluginRoot = join(input.execDir, "plugin")
    const report = await memoryRuntimeReport({
      env,
      maxBytesFor: memoryRuntimeMaxBytesResolver({ pluginRoot, env }),
      discardFor: memoryRuntimeDiscardResolver({ pluginRoot, env }),
    })
    return report.lines
  } catch (error) {
    // A runtime the user cannot read (EACCES) must not take the rest of doctor down with it.
    return [memoryRuntimeUnavailableLine(error)]
  }
}

function memoryRuntimeUnavailableLine(error: unknown): string {
  return `WARN memory runtime: unavailable: ${error instanceof Error ? error.message : String(error)}`
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
    process.exitCode = await printDoctorReap(input.args.slice(1), options)
    return
  }
  const env = options.env ?? process.env
  if (input.args?.[0] === "--fix") {
    // The global memory settings come from this binary's provisioned runtime, not the npm package layout.
    const taskConfig = join(input.execDir, "plugin", TASK_CONFIG_RUNTIME)
    process.exitCode = await printDoctorFix(input.args.slice(1), {
      env,
      ...(options.homeDir === undefined ? {} : { home: options.homeDir }),
      loadTaskConfig: () => createRequire(import.meta.url)(taskConfig),
    })
    return
  }
  if (input.args?.[0] === "--models") {
    process.exitCode = await runDoctorModels([...input.args.slice(1)], {
      agentDir: canonicalAgentDir(env),
      env,
      loadRuntime: compiledDiagnosticRuntimeLoader(input.execDir),
      loadEngine: loadCompiledCoverageEngine,
    })
    return
  }
  process.exitCode = await printDoctorReport({
    ...options,
    inventory: input.inventory,
    ...(input.engine === undefined ? {} : { daemonEngine: input.engine }),
    install: {
      kind: "compiled",
      execDir: input.execDir,
      version: input.version,
      versionText: input.versionText,
      updateCommand: input.updateCommand,
      sources: {
        config: () => configDoctorLines({ cwd: process.cwd(), env }),
        trust: () => trustLines(options),
        claudeCode: () => claudeCodeDoctorLines({ runtimeDir: input.execDir, env }),
        computerUse: () => computerUseLines(input, env),
        coverage: () => coverageLines(input, env),
        memoryRuntime: () => memoryRuntimeLines(input, env),
        keychainHelper: () =>
          options.keychainHelperLines?.() ??
          keychainHelperDoctorLines({ packageRoot: input.execDir, helperRelPath: "omo-keychain" }),
      },
    },
  })
}
