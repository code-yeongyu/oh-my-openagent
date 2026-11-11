#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// The tracked mode of the generated installer. It is never executed directly
// (every caller runs `node scripts/install.mjs`), so it stays 0644; bun build
// marks a shebang entry's output executable, which flipped this file to 0755
// on a container regen (#12394).
const INSTALLER_MODE = 0o644

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginRoot = dirname(scriptDir)
const packageRoot = dirname(pluginRoot)
const repoRoot = join(packageRoot, "..", "..")
const entryPath = join(packageRoot, "src", "install", "cli-local.ts")
const outputPath = process.env.OMO_SENPI_PLUGIN_OUTPUT === undefined
  ? join(pluginRoot, "scripts", "install.mjs")
  : join(process.env.OMO_SENPI_PLUGIN_OUTPUT, "scripts", "install.mjs")

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
  // bun build marks a shebang entry's output executable; the tracked installer
  // is never executed directly, so pin its mode instead of letting the
  // generator's umask or a pre-existing mode ride into the repo (#12394).
  await chmod(output, INSTALLER_MODE)
  return { output }
}

/**
 * True when the committed installer matches a fresh build of its source. The installer embeds the
 * required-artifact list, so a stale copy demands files the plugin no longer ships and refuses to
 * install; nothing else in CI reads this artifact, which is why it needs its own gate.
 */
export async function checkInstallCliCurrent(options = {}) {
  const committed = options.outputPath ?? outputPath
  const tempRoot = await mkdtemp(join(tmpdir(), "omo-senpi-install-check-"))
  try {
    const { output } = await buildInstallCli({ outputPath: join(tempRoot, "scripts", "install.mjs") })
    const [current, fresh] = await Promise.all([
      readFile(committed, "utf8").catch(() => undefined),
      readFile(output, "utf8"),
    ])
    if (current === undefined) return { current: false, reason: `missing installer: ${committed}` }
    if (current !== fresh) return { current: false, reason: `stale installer: ${committed} differs from a fresh build of src/install/cli-local.ts` }
    // A mode-only drift is invisible to the content comparison above, yet it
    // is exactly how #12394 shipped: fail the gate so a regen cannot flip
    // the tracked mode silently. Windows has no POSIX mode bits to compare.
    if (process.platform !== "win32") {
      const mode = (await stat(committed)).mode & 0o777
      if (mode !== INSTALLER_MODE) return { current: false, reason: `installer mode is 0o${mode.toString(8)}, expected 0o${INSTALLER_MODE.toString(8)}: ${committed}` }
    }
    return { current: true }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--check")) {
    const result = await checkInstallCliCurrent()
    if (!result.current) {
      console.error(`omo-senpi installer is not current: ${result.reason}`)
      process.exit(1)
    }
    console.log(`omo-senpi installer is current: ${outputPath}`)
  } else {
    await buildInstallCli()
    console.log(`Built omo-senpi installer: ${outputPath}`)
  }
}
