import { join } from "node:path"

import { astGrepRuntimeDir, runAstGrepSkillInstall, type RunAstGrepSkillInstall } from "@oh-my-opencode/utils"

interface CodexAstGrepInstalledPlugin {
  readonly marketplaceName?: string
  readonly name: string
  readonly path: string
  readonly version: string
}

export interface CodexAstGrepInstallOptions {
  readonly arch?: string
  readonly codexHome: string
  readonly installed: readonly CodexAstGrepInstalledPlugin[]
  readonly installer?: RunAstGrepSkillInstall
  readonly log?: (message: string) => void
  readonly platform?: NodeJS.Platform
}

function describeResult(result: Awaited<ReturnType<RunAstGrepSkillInstall>>): string | null {
  if (result.kind === "succeeded") return null
  if (result.kind === "timed-out") return "timed out after 30s"
  return result.reason
}

export async function installAstGrepForCodex(options: CodexAstGrepInstallOptions): Promise<void> {
  const plugin = options.installed.find((entry) => entry.name === "omo")
  if (plugin === undefined) return
  const platform = options.platform ?? process.platform
  const targetDir = astGrepRuntimeDir(options.codexHome, platform, options.arch ?? process.arch)
  const skillDir = join(plugin.path, "skills", "ast-grep")
  const installer = options.installer ?? runAstGrepSkillInstall
  try {
    const result = await installer({ platform, skillDir, targetDir })
    const failure = describeResult(result)
    if (failure !== null) options.log?.(`[ast-grep] skipped sg provisioning: ${failure}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    options.log?.(`[ast-grep] skipped sg provisioning: ${message}`)
  }
}
