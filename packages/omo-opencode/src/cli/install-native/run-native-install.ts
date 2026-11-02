import { homedir } from "node:os"
import { bunWhich } from "../../shared/bun-which-shim"
import { spawnWithWindowsHide } from "../../shared/spawn-with-windows-hide"
import { legacyOmoBins, resolveOmoBinEnvironment, scanOmoBins } from "./legacy-omo-bin"
import type { OmoBinEnvironment } from "./legacy-omo-bin"
import { removeFileCommand, repairLegacyOmoBins } from "./repair-legacy-omo-bin"
import { verifyOmoCommand } from "./verify-omo-command"
import type { OmoVersionProbe } from "./verify-omo-command"
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
  readonly environment: OmoBinEnvironment
  readonly probeVersion: OmoVersionProbe
}

export interface NativeInstallFailure {
  readonly reason: string
  readonly manualCommand: string
  readonly hints?: readonly string[]
}

export interface NativeInstallOutcome {
  readonly ok: boolean
  /** The `omo` that PATH resolves after the install is the one omo-ai owns. */
  readonly verified: boolean
  /** The verified omo-ai binary; set only when `verified`, so onboarding never runs a bare `omo` lookup. */
  readonly omoBinPath?: string
  readonly plan: NativeInstallPlan
  readonly notes: readonly string[]
  readonly warnings: readonly string[]
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
  const environment = dependencies.environment
  const notes = plan.packageManager === "npm" ? [NATIVE_RECOMMENDED_RUNTIME_NOTE] : []
  const warnings: string[] = []
  const manualCommand = formatNativeInstallCommand(plan)

  // A pre-rename release owns the global `omo` name. npm refuses to overwrite it (EEXIST) and bun
  // installs beside it, so the repair has to happen before the package manager runs either way.
  const repair = repairLegacyOmoBins(legacyOmoBins(scanOmoBins(environment)), { isWindows: environment.isWindows })
  notes.push(...repair.notes)
  warnings.push(...repair.warnings)
  const hints = repair.failures.map(
    (failure) =>
      `Remove the stale omo command first: ${removeFileCommand(failure.binPath, environment.isWindows)}`,
  )

  const failed = (reason: string): NativeInstallOutcome => ({
    ok: false,
    verified: false,
    plan,
    notes,
    warnings,
    failure: hints.length > 0 ? { reason, manualCommand, hints } : { reason, manualCommand },
  })

  try {
    const result = await dependencies.spawn(plan.command, plan.args)
    if (result.exitCode !== 0) return failed(describeExit(plan, result))
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error))
  }

  // npm unlinks every bin name a package declares when it is uninstalled, whoever owns the file now,
  // so uninstalling the old package later takes omo-ai's `omo` from the shared npm bin dir with it.
  // bun keeps a bin another package owns, so only the npm path needs this.
  if (plan.packageManager === "npm") {
    for (const name of new Set(repair.removed.map((removal) => removal.packageName))) {
      if (NPM_LEGACY_OMO_PACKAGES.includes(name)) notes.push(npmUninstallNote(name, manualCommand))
    }
  }

  const verification = await verifyOmoCommand({ environment, probeVersion: dependencies.probeVersion })
  notes.push(...verification.notes)
  warnings.push(...verification.warnings)
  return verification.ok
    ? { ok: true, verified: true, omoBinPath: verification.binPath, plan, notes, warnings }
    : { ok: true, verified: false, plan, notes, warnings }
}

const NPM_LEGACY_OMO_PACKAGES: readonly string[] = ["oh-my-openagent", "oh-my-opencode"]

function npmUninstallNote(packageName: string, installCommand: string): string {
  return `If you later run npm uninstall -g ${packageName}, npm also deletes the omo command omo-ai now owns. Run ${installCommand} again afterwards to restore it.`
}

export function nativeInstallSuccessLine(verified: boolean): string {
  if (!verified) {
    // `omo setup` would run whatever `omo` PATH resolves, which the verify step just said is not omo-ai.
    return `OmO Native installed, but omo on your PATH is not omo-ai yet. Apply the fix above, then run ${NATIVE_SETUP_COMMAND}.`
  }
  return `OmO Native installed. Run ${NATIVE_SETUP_COMMAND} to finish onboarding.`
}

export function nativeInstallFailureLines(failure: NativeInstallFailure): readonly string[] {
  return [
    `OmO Native install failed: ${failure.reason}`,
    ...(failure.hints ?? []),
    `Install it yourself with: ${failure.manualCommand}`,
    `Then run ${NATIVE_SETUP_COMMAND}.`,
  ]
}

function defaultNativeInstallDependencies(): NativeInstallDependencies {
  return {
    isBunAvailable: () => bunWhich("bun") !== null,
    environment: resolveOmoBinEnvironment({ env: process.env, platform: process.platform, homeDir: homedir() }),
    spawn: async (command, args) => {
      const proc = spawnWithWindowsHide([command, ...args], {
        env: process.env,
        stdout: "inherit",
        stderr: "inherit",
      })
      return { exitCode: await proc.exited }
    },
    probeVersion: async (command, args) => {
      const proc = spawnWithWindowsHide([command, ...args], {
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      })
      const stdout = proc.stdout === undefined ? "" : await new Response(proc.stdout).text()
      return { exitCode: await proc.exited, stdout }
    },
  }
}
