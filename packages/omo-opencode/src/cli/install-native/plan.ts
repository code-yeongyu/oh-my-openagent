import { PUBLISHED_PACKAGE_NAME } from "../../shared"
import { getBundledVersion } from "../../hooks/auto-update-checker/checker/bundled-version"
import { isPrereleaseVersion } from "../../hooks/auto-update-checker/version-channel"

export const NATIVE_PACKAGE_SPEC = "omo-ai@beta"
export const NATIVE_SETUP_COMMAND = "omo setup"
export const NATIVE_RECOMMENDED_RUNTIME_NOTE =
  "bun is the recommended runtime for OmO Native; npm works, but bun is what the beta channel is tested on."

export type NativePackageManager = "bun" | "npm"

export interface NativeInstallPlan {
  readonly packageManager: NativePackageManager
  readonly command: string
  readonly args: readonly string[]
}

const PLANS: Record<NativePackageManager, NativeInstallPlan> = {
  bun: { packageManager: "bun", command: "bun", args: ["add", "-g", NATIVE_PACKAGE_SPEC] },
  npm: { packageManager: "npm", command: "npm", args: ["i", "-g", NATIVE_PACKAGE_SPEC] },
}

export function resolveNativeInstallPlan(bunAvailable: boolean): NativeInstallPlan {
  return bunAvailable ? PLANS.bun : PLANS.npm
}

export function formatNativeInstallCommand(plan: NativeInstallPlan): string {
  return [plan.command, ...plan.args].join(" ")
}

/**
 * The command every user-facing surface advertises. It is the raw package install plus the parts a
 * raw install cannot do: clearing a stale global `omo` left by a pre-rename release, and checking
 * that the `omo` PATH resolves afterwards is the one omo-ai owns. The tag follows the channel of the
 * running plugin: a prerelease build advertises `@beta` (while `latest` is 4.19.4, which rejects
 * `--platform=native`), a stable build advertises the bare name, which resolves to `latest`.
 */
export function formatNativeInstallEntryCommand(
  plan: NativeInstallPlan,
  pluginVersion: string = getBundledVersion(),
): string {
  const runner = plan.packageManager === "bun" ? "bunx" : "npx"
  const tag = isPrereleaseVersion(pluginVersion) ? "@beta" : ""
  return `${runner} ${PUBLISHED_PACKAGE_NAME}${tag} install --platform=native`
}
