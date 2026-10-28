import { dirname, join } from "node:path"
import type { RequirementCheck } from "./signature"
import { runtimeDeclaresKeychainHandoff } from "./runtime-capabilities"
import { verifyWithSecurityFramework } from "./signature"

const DEVELOPER_ID_TEAM =
  'anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] and certificate leaf[field.1.2.840.113635.100.6.1.13] and certificate leaf[subject.OU] = "523JNR86LZ"'
export const DESKTOP_RUNTIME_REQUIREMENT = `identifier "com.mengmota.omo-desktop-runtime" and ${DEVELOPER_ID_TEAM}`
/** The app bundle as a whole: any Developer ID signature of our team, with every nested piece sealed (--deep --strict). */
export const DESKTOP_APP_REQUIREMENT = DEVELOPER_ID_TEAM

/** Set in the creator's environment: that process never hands off in turn and never shows a keychain dialog. */
export const HANDOFF_ENV = "OMO_KEYCHAIN_HANDOFF"
// The desktop gives `omo account token` the same deadline (apps/desktop/src/account/omoAccountProcess.ts).
const HANDOFF_DEADLINE_MS = 45_000

export type DesktopRuntime = { readonly app: string; readonly runtime: string }

export function desktopRuntimeCandidates(home: string, arch: string = process.arch): readonly DesktopRuntime[] {
  const runtimeArch = arch === "arm64" ? "arm64" : "x64"
  return ["/Applications/OmO.app", join(home, "Applications", "OmO.app")].map(app => ({
    app,
    runtime: join(app, "Contents", "Resources", "omo-runtime", `darwin-${runtimeArch}`, "omo"),
  }))
}

export type BundleCheck = (app: string, requirement: string) => Promise<boolean>

const verifyBundle: BundleCheck = async (app, requirement) => {
  const child = Bun.spawn(["/usr/bin/codesign", "--verify", "--deep", "--strict", `-R=${requirement}`, app], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
  return (await child.exited) === 0
}

export type HandOffRunner = (path: string, args: readonly string[], env: Record<string, string>, deadlineMs: number) => Promise<number | null>

const runBounded: HandOffRunner = async (path, args, env, deadlineMs) => {
  const child = Bun.spawn([path, ...args], { cwd: dirname(path), stdin: "ignore", stdout: "ignore", stderr: "ignore", env })
  const timer = setTimeout(() => child.kill("SIGKILL"), deadlineMs)
  try {
    const code = await child.exited
    return child.signalCode === null ? code : null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Addendum change 1 (rows 7, 8): before the one dialog, ask the side that created the item to move it to the helper.
 * The runtime is run from inside its app bundle, never from a copy: it finds its own keychain helper next to itself,
 * which is what lets it migrate. So the whole bundle is verified (`codesign --deep --strict` against our team) and the
 * runtime against its designated requirement immediately before the spawn. True only when a verified creator exited
 * cleanly; a missing app, a failed check, a failed spawn or a non-zero exit is false, and the caller shows its dialog.
 */
export function createCreatorHandOff(options: {
  readonly candidates: readonly DesktopRuntime[]
  readonly origin?: string
  readonly env?: NodeJS.ProcessEnv
  readonly checkRuntime?: RequirementCheck
  readonly checkBundle?: BundleCheck
  readonly declaresHandOff?: (runtime: string) => Promise<boolean>
  readonly run?: HandOffRunner
  readonly selfPath?: string
}): () => Promise<boolean> {
  return async () => {
    const env = options.env ?? process.env
    if (env[HANDOFF_ENV] === "1") return false
    const checkRuntime = options.checkRuntime ?? verifyWithSecurityFramework
    const checkBundle = options.checkBundle ?? verifyBundle
    const declaresHandOff = options.declaresHandOff ?? runtimeDeclaresKeychainHandoff
    const self = options.selfPath ?? process.execPath
    for (const { app, runtime } of options.candidates) {
      if (runtime === self || !(await Bun.file(runtime).exists())) continue
      // RULING-74: only a runtime that declares the hand-off contract itself (its capability file, inside the sealed
      // bundle) is asked; an already-shipped runtime would ignore the marker and show its own dialog.
      const verified = await Promise.resolve()
        .then(
          async () =>
            (await checkBundle(app, DESKTOP_APP_REQUIREMENT)) &&
            (await checkRuntime(runtime, DESKTOP_RUNTIME_REQUIREMENT)) &&
            (await declaresHandOff(runtime)),
        )
        .catch(() => false)
      if (!verified) continue
      const childEnv: Record<string, string> = { [HANDOFF_ENV]: "1" }
      if (env.HOME !== undefined) childEnv.HOME = env.HOME
      const origin = options.origin ?? env.OMO_SERVICE_API_URL
      if (origin !== undefined) childEnv.OMO_SERVICE_API_URL = origin
      try {
        return (await (options.run ?? runBounded)(runtime, ["account", "token"], childEnv, HANDOFF_DEADLINE_MS)) === 0
      } catch {
        return false
      }
    }
    return false
  }
}
