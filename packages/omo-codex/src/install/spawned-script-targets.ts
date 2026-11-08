import { stat } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"

export interface SpawnedCommandInvocation {
  readonly command: string
  readonly args: readonly string[]
}

const SCRIPT_ARGUMENT_PATTERN = /\.(?:mjs|cjs|js)$/

export async function findMissingSpawnedScripts(input: {
  readonly invocations: readonly SpawnedCommandInvocation[]
  readonly repoRoot: string
  readonly nodeExecutable?: string
}): Promise<readonly string[]> {
  const nodeExecutable = input.nodeExecutable ?? process.execPath
  const repoRoot = resolve(input.repoRoot)
  const missing: string[] = []
  for (const invocation of input.invocations) {
    if (invocation.command !== nodeExecutable) continue
    const scriptPath = invocation.args[0]
    if (scriptPath === undefined || !SCRIPT_ARGUMENT_PATTERN.test(scriptPath)) continue
    if (!isAbsolute(scriptPath)) continue
    const relativePath = relative(repoRoot, scriptPath)
    if (relativePath.startsWith(`..${sep}`) || relativePath === "..") continue
    const exists = await stat(scriptPath).then(() => true, () => false)
    if (!exists) missing.push(scriptPath)
  }
  return missing
}
