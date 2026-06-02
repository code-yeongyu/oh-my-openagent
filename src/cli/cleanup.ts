import { cleanupCodexLight } from "./install-codex/codex-cleanup"

export type CleanupPlatform = "codex"

export interface CleanupOptions {
  readonly platform?: CleanupPlatform | "opencode" | "both"
  readonly codexHome?: string
  readonly project?: string
  readonly json?: boolean
}

export function resolveCleanupPlatform(
  options: { readonly platform?: CleanupOptions["platform"] },
  invocationName: string | undefined = process.env.OMO_INVOCATION_NAME,
): CleanupOptions["platform"] | undefined {
  if (options.platform !== undefined) return options.platform
  return invocationName === "lazycodex" || invocationName === "lazycodex-ai" ? "codex" : undefined
}

export async function cleanup(options: CleanupOptions): Promise<number> {
  if (options.platform !== "codex") {
    console.error("Error: cleanup currently supports only --platform=codex")
    return 1
  }

  const result = await cleanupCodexLight({
    codexHome: options.codexHome,
    projectDirectory: options.project,
  })

  if (options.json === true) {
    console.log(JSON.stringify(result, null, 2))
    return 0
  }

  console.log(`Codex Light cleanup complete: ${result.codexHome}`)
  if (result.configChanged) {
    console.log(`- Updated ${result.configPath}`)
    if (result.configBackupPath !== undefined) console.log(`- Backup ${result.configBackupPath}`)
  } else {
    console.log(`- No managed Codex config blocks found in ${result.configPath}`)
  }
  for (const path of result.removedPaths) {
    console.log(`- Removed ${path}`)
  }
  for (const path of result.removedAgentLinks) {
    console.log(`- Removed managed agent link ${path}`)
  }
  for (const path of result.skippedAgentLinks) {
    console.log(`- Skipped agent path outside managed scope ${path}`)
  }
  if (result.projectCleanup.changed) {
    console.log(`- Repaired project-local Codex config ${result.projectCleanup.configPath}`)
  }
  for (const artifact of result.projectCleanup.artifacts) {
    console.log(`- Left project-local artifact in place ${artifact.path}`)
  }

  return 0
}
