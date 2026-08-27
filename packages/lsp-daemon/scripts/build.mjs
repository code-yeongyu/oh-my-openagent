#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const distDir = process.env.OMO_LSP_DAEMON_DIST ?? join(packageRoot, "dist")
const tempParent = await mkdtemp(join(dirname(distDir), ".tmp-lsp-daemon-build-"))
const tempDist = join(tempParent, "dist")
const backupDist = `${distDir}.backup-${process.pid}`

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: packageRoot, stdio: "inherit", shell: process.platform === "win32", ...options })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

try {
  await mkdir(tempDist, { recursive: true })
  run("tsc", ["-p", "tsconfig.build.json", "--outDir", tempDist])
  run("bun", ["build", "src/cli.ts", "src/index.ts", "src/client.ts", "--outdir", tempDist, "--target", "node", "--format", "esm"])
  run(process.execPath, ["scripts/stamp-dist-version.mjs", tempDist], { shell: false })
  if (!existsSync(join(tempDist, "cli.js"))) throw new Error(`build completed without ${join(tempDist, "cli.js")}`)
  if (existsSync(distDir)) await rename(distDir, backupDist)
  try {
    await rename(tempDist, distDir)
  } catch (error) {
    if (existsSync(backupDist)) await rename(backupDist, distDir)
    throw error
  }
  if (existsSync(backupDist)) await rm(backupDist, { recursive: true, force: true })
} finally {
  await rm(tempParent, { recursive: true, force: true })
}
