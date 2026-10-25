import type { InstallArgs } from "./types"
import { isNativeDevPlatformEnabled, NATIVE_DEV_PLATFORM_ENV_FLAG } from "./native-dev-platform-flag"

export type InstallCommandOptions = {
  readonly tui?: boolean
  readonly claude?: InstallArgs["claude"]
  readonly openai?: InstallArgs["openai"]
  readonly gemini?: InstallArgs["gemini"]
  readonly copilot?: InstallArgs["copilot"]
  readonly platform?: InstallArgs["platform"]
  readonly opencodeZen?: InstallArgs["opencodeZen"]
  readonly zaiCodingPlan?: InstallArgs["zaiCodingPlan"]
  readonly kimiForCoding?: InstallArgs["kimiForCoding"]
  readonly opencodeGo?: InstallArgs["opencodeGo"]
  readonly bailianCodingPlan?: InstallArgs["bailianCodingPlan"]
  readonly minimaxCnCodingPlan?: InstallArgs["minimaxCnCodingPlan"]
  readonly minimaxCodingPlan?: InstallArgs["minimaxCodingPlan"]
  readonly vercelAiGateway?: InstallArgs["vercelAiGateway"]
  readonly codexAutonomous?: InstallArgs["codexAutonomous"]
  readonly skipAuth?: boolean
}

export function resolveInstallArgs(
  options: InstallCommandOptions,
  invocationName: string | undefined = process.env.OMO_INVOCATION_NAME,
): InstallArgs {
  const defaultPlatform =
    process.env.OMO_EDITION === "codex" || invocationName === "lazycodex" || invocationName === "lazycodex-ai" ? "codex" : undefined
  const platform = options.platform ?? defaultPlatform
  if (platform === "native-dev" && !isNativeDevPlatformEnabled()) {
    throw new Error(
      `The native-dev install platform is not available in this release. Set ${NATIVE_DEV_PLATFORM_ENV_FLAG}=1 to enable it from a source checkout.`,
    )
  }

  return {
    tui: options.tui !== false,
    claude: options.claude,
    openai: options.openai,
    gemini: options.gemini,
    copilot: options.copilot,
    platform,
    opencodeZen: options.opencodeZen,
    zaiCodingPlan: options.zaiCodingPlan,
    kimiForCoding: options.kimiForCoding,
    opencodeGo: options.opencodeGo,
    bailianCodingPlan: options.bailianCodingPlan,
    minimaxCnCodingPlan: options.minimaxCnCodingPlan,
    minimaxCodingPlan: options.minimaxCodingPlan,
    vercelAiGateway: options.vercelAiGateway,
    codexAutonomous: options.codexAutonomous,
    skipAuth: options.skipAuth ?? false,
  }
}
