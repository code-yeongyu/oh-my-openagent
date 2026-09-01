import { lstat, readdir, rm } from "node:fs/promises"
import { join } from "node:path"

const SELF_PACKAGE_NAMES = ["oh-my-opencode", "oh-my-openagent"] as const

export async function removeStaleSelfPackageTests(root = process.cwd()): Promise<string[]> {
  const packagesDir = join(root, "packages")
  const packageEntries = await readdir(packagesDir, { withFileTypes: true })
  const removed: string[] = []

  for (const packageEntry of packageEntries) {
    if (!packageEntry.isDirectory()) continue

    for (const packageName of SELF_PACKAGE_NAMES) {
      const candidate = join(packagesDir, packageEntry.name, "node_modules", packageName)
      if (!await pathExists(candidate)) continue
      await rm(candidate, { recursive: true, force: true })
      removed.push(["packages", packageEntry.name, "node_modules", packageName].join("/"))
    }
  }

  return removed.sort()
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false
    throw error
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code
}

if (import.meta.main) {
  const removed = await removeStaleSelfPackageTests()
  console.log(
    removed.length === 0
      ? "No stale self-package test copies found."
      : `Removed stale self-package test copies:\n${removed.map((path) => `- ${path}`).join("\n")}`,
  )
}
