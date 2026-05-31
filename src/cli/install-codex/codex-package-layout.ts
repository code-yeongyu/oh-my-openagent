import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

const PACKAGED_CODEX_INSTALLER_NAMES = new Set([
  "@code-yeongyu/lazycodex",
  "@code-yeongyu/lazycodex-ai",
  "lazycodex",
  "lazycodex-ai",
  "oh-my-opencode",
  "oh-my-openagent",
])

export async function shouldBuildSourcePackages(repoRoot: string): Promise<boolean> {
  if (existsSync(join(repoRoot, "src", "index.ts"))) return true
  const packageJsonPath = join(repoRoot, "package.json")
  if (!existsSync(packageJsonPath)) return true
  const packageJson: unknown = JSON.parse(await readFile(packageJsonPath, "utf8"))
  if (!isRecord(packageJson) || typeof packageJson.name !== "string") return true
  return !PACKAGED_CODEX_INSTALLER_NAMES.has(packageJson.name)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
