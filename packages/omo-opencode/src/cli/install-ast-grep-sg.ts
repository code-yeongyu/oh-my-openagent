import { homedir } from "node:os"
import { join } from "node:path"

import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills"
import { astGrepRuntimeDir, runAstGrepSkillInstall, type RunAstGrepSkillInstall } from "@oh-my-opencode/utils"

export interface OpenCodeAstGrepInstallOptions {
  readonly arch?: string
  readonly homeDir?: string
  readonly installer?: RunAstGrepSkillInstall
  readonly log?: (message: string) => void
  readonly platform?: NodeJS.Platform
  readonly sharedSkillsRoot?: string
}

function describeResult(result: Awaited<ReturnType<RunAstGrepSkillInstall>>): string | null {
  if (result.kind === "succeeded") return null
  if (result.kind === "timed-out") return "timed out after 30s"
  return result.reason
}

export async function installAstGrepForOpenCode(options: OpenCodeAstGrepInstallOptions = {}): Promise<void> {
  const platform = options.platform ?? process.platform
  const baseDir = join(options.homeDir ?? homedir(), ".omo")
  const targetDir = astGrepRuntimeDir(baseDir, platform, options.arch ?? process.arch)
  const skillDir = join(options.sharedSkillsRoot ?? sharedSkillsRootPath(), "ast-grep")
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
