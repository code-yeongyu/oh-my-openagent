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
