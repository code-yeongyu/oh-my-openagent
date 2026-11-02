import { spawnWithWindowsHide } from "../../shared/spawn-with-windows-hide"
import { NATIVE_SETUP_COMMAND } from "./plan"
import type { NativeInstallOutcome } from "./run-native-install"

export const NATIVE_SETUP_OFFER_QUESTION =
  "Run omo setup now to carry your OpenCode credentials, MCP servers and skills over?"

export type NativeSetupRun = (binPath: string, args: readonly string[]) => Promise<number>

export interface NativeSetupOfferDependencies {
  readonly confirm: (question: string) => Promise<boolean>
  readonly runSetup?: NativeSetupRun
  /** Receives the start line right before the setup process takes over the terminal. */
  readonly onStart?: (line: string) => void
}

export type NativeSetupOfferResult =
  | { readonly kind: "not-offered" }
  | { readonly kind: "declined" }
  | { readonly kind: "ran"; readonly binPath: string; readonly exitCode: number }
  | { readonly kind: "failed"; readonly binPath: string; readonly reason: string }

/**
 * Offers to run onboarding with the exact binary the install just verified. An unverified install
 * is never offered: whatever `omo` PATH resolves there is, by definition, not omo-ai, and the PATH
 * fix printed by the verify step stays the next thing to do.
 */
export async function offerNativeSetup(
  outcome: Pick<NativeInstallOutcome, "verified" | "omoBinPath">,
  dependencies: NativeSetupOfferDependencies,
): Promise<NativeSetupOfferResult> {
  const binPath = outcome.verified ? outcome.omoBinPath : undefined
  if (binPath === undefined) return { kind: "not-offered" }
  if (!(await dependencies.confirm(NATIVE_SETUP_OFFER_QUESTION))) return { kind: "declined" }
  const runSetup = dependencies.runSetup ?? runSetupInheritingTerminal
  dependencies.onStart?.(nativeSetupStartLine(binPath))
  try {
    return { kind: "ran", binPath, exitCode: await runSetup(binPath, ["setup"]) }
  } catch (error) {
    return { kind: "failed", binPath, reason: error instanceof Error ? error.message : String(error) }
  }
}

export function nativeSetupStartLine(binPath: string): string {
  return `Starting ${binPath} setup`
}

/** The line to print after the offer, or null when the offer already finished onboarding. */
export function nativeSetupFollowUpLine(result: NativeSetupOfferResult): string | null {
  if (result.kind === "failed") {
    return `Could not start ${result.binPath} setup (${result.reason}). Run ${NATIVE_SETUP_COMMAND} to finish onboarding.`
  }
  if (result.kind !== "ran" || result.exitCode === 0) return null
  return `omo setup exited with code ${result.exitCode}. Run ${NATIVE_SETUP_COMMAND} again to finish onboarding.`
}

async function runSetupInheritingTerminal(binPath: string, args: readonly string[]): Promise<number> {
  const proc = spawnWithWindowsHide([binPath, ...args], {
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  return proc.exited
}
