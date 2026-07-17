#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginRoot = dirname(scriptDir)
const packageRoot = dirname(pluginRoot)
const repoRoot = join(packageRoot, "..", "..")
const entryPath = join(packageRoot, "src", "install", "cli-local.ts")
const outputPath = join(pluginRoot, "scripts", "install.mjs")

export async function buildInstallCli(options = {}) {
  const output = options.outputPath ?? outputPath
  await mkdir(dirname(output), { recursive: true })
  const result = spawnSync(
    "bun",
    [
      "build",
      entryPath,
      "--target",
      "node",
      "--format",
      "esm",
      "--outfile",
      output,
      "--external",
      "@code-yeongyu/senpi",
      "--external",
      "typebox",
      "--external",
      "typebox/compile",
      "--external",
      "typebox/value",
    ],
    {
      cwd: repoRoot,
      shell: process.platform === "win32",
      stdio: "inherit",
    },
  )
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
  return { output }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildInstallCli()
  console.log(`Built omo-senpi installer: ${outputPath}`)
}
