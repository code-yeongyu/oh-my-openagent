import { bunWhich } from "../../shared/bun-which-shim"
import { spawnWithWindowsHide } from "../../shared/spawn-with-windows-hide"
import {
  formatNativeInstallCommand,
  NATIVE_RECOMMENDED_RUNTIME_NOTE,
  NATIVE_SETUP_COMMAND,
  resolveNativeInstallPlan,
} from "./plan"
import type { NativeInstallPlan } from "./plan"

export interface NativeInstallSpawnResult {
  readonly exitCode: number
  readonly stderr?: string
}

export type NativeInstallSpawn = (
  command: string,
  args: readonly string[],
) => Promise<NativeInstallSpawnResult>

export interface NativeInstallDependencies {
  readonly isBunAvailable: () => boolean | Promise<boolean>
  readonly spawn: NativeInstallSpawn
}

export interface NativeInstallFailure {
  readonly reason: string
  readonly manualCommand: string
}

export interface NativeInstallOutcome {
  readonly ok: boolean
  readonly plan: NativeInstallPlan
  readonly notes: readonly string[]
  readonly failure?: NativeInstallFailure
}

function describeExit(plan: NativeInstallPlan, result: NativeInstallSpawnResult): string {
  const stderr = result.stderr?.trim()
  const head = `${plan.packageManager} exited with code ${result.exitCode}`
  return stderr ? `${head}: ${stderr.split("\n").slice(-3).join(" ")}` : head
}

export async function runNativeInstall(
  dependencies: NativeInstallDependencies = defaultNativeInstallDependencies(),
): Promise<NativeInstallOutcome> {
  const plan = resolveNativeInstallPlan(await dependencies.isBunAvailable())
  const notes = plan.packageManager === "npm" ? [NATIVE_RECOMMENDED_RUNTIME_NOTE] : []
  const manualCommand = formatNativeInstallCommand(plan)

  try {
    const result = await dependencies.spawn(plan.command, plan.args)
    if (result.exitCode === 0) return { ok: true, plan, notes }
    return { ok: false, plan, notes, failure: { reason: describeExit(plan, result), manualCommand } }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, plan, notes, failure: { reason, manualCommand } }
  }
}

export function nativeInstallSuccessLine(): string {
  return `OmO Native installed. Run ${NATIVE_SETUP_COMMAND} to finish onboarding.`
}

export function nativeInstallFailureLines(failure: NativeInstallFailure): readonly string[] {
  return [
    `OmO Native install failed: ${failure.reason}`,
    `Install it yourself with: ${failure.manualCommand}`,
    `Then run ${NATIVE_SETUP_COMMAND}.`,
  ]
}

function defaultNativeInstallDependencies(): NativeInstallDependencies {
  return {
    isBunAvailable: () => bunWhich("bun") !== null,
    spawn: async (command, args) => {
      const proc = spawnWithWindowsHide([command, ...args], {
        env: process.env,
        stdout: "inherit",
        stderr: "inherit",
      })
      return { exitCode: await proc.exited }
    },
  }
}
