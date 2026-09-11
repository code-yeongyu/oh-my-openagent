import { cleanupCodexLight } from "./install-codex/codex-cleanup"
import {
  removeManagedOpenCodeAgentDefinitions,
  type OpenCodeAgentCleanupResult,
} from "./opencode-agent-cleanup"

export type CleanupPlatform = "codex"

export interface CleanupOptions {
  readonly platform?: CleanupPlatform | "opencode" | "both"
  readonly codexHome?: string
  readonly configDir?: string
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

type CodexCleanupResult = Awaited<ReturnType<typeof cleanupCodexLight>>

function printCodexResult(result: CodexCleanupResult): void {
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
  for (const skippedPath of result.skippedPaths) {
    console.log(`- Skipped cleanup target ${skippedPath.path}: ${skippedPath.reason}`)
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
}

function printOpencodeResult(result: OpenCodeAgentCleanupResult): void {
  for (const dir of result.scannedDirs) {
    console.log(`- Scanned OpenCode agents directory ${dir}`)
  }
  for (const path of result.removedPaths) {
    console.log(`- Removed omo agent definition ${path}`)
  }
}

export async function cleanup(options: CleanupOptions): Promise<number> {
  const platform = options.platform ?? "opencode"
  const runCodex = platform === "codex" || platform === "both"
  const runOpencode = platform === "opencode" || platform === "both"

  let codexResult: CodexCleanupResult | undefined
  if (runCodex) {
    codexResult = await cleanupCodexLight({
      codexHome: options.codexHome,
      projectDirectory: options.project,
    })
  }

  let opencodeResult: OpenCodeAgentCleanupResult | undefined
  if (runOpencode) {
    opencodeResult = removeManagedOpenCodeAgentDefinitions({
      configDir: options.configDir,
      project: options.project,
    })
  }

  if (options.json === true) {
    console.log(JSON.stringify({ platform, ...codexResult, ...opencodeResult }, null, 2))
    return 0
  }

  if (codexResult !== undefined) printCodexResult(codexResult)
  if (opencodeResult !== undefined) printOpencodeResult(opencodeResult)

  return 0
}
