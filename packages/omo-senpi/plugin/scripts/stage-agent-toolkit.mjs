#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { access, chmod, copyFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginRoot = dirname(scriptDir)
const packageRoot = dirname(pluginRoot)
const repoRoot = resolve(packageRoot, "..", "..")
const codexPluginRoot = join(repoRoot, "packages", "omo-codex", "plugin")
const codexPluginNodeModules = join(codexPluginRoot, "node_modules")
const defaultSourceEntry = join(codexPluginRoot, "components", "ulw-loop", "dist", "cli.js")
const defaultDirectiveEntry = join(codexPluginRoot, "components", "ulw-loop", "directive.md")
const defaultTargetDir = join(pluginRoot, "runtime", "agent-toolkit")
const packageLock = join(codexPluginRoot, "package-lock.json")
const installedPackageLock = join(codexPluginRoot, "node_modules", ".package-lock.json")

const dispatcher = `import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const components = { "ulw-loop": join(dirname(fileURLToPath(import.meta.url)), "ulw-loop", "cli.js") }
const [component, ...args] = process.argv.slice(2)
const entry = components[component]
if (entry === undefined) {
  console.error(\`Unknown component: \${component ?? "(missing)"}. Available components: ulw-loop\`)
  process.exit(1)
}
const result = spawnSync(process.execPath, [entry, ...args], { stdio: "inherit" })
if (result.error !== undefined) throw result.error
process.exit(result.status ?? 1)
`
const posixShim = "#!/bin/sh\nexec node \"$(dirname \"$0\")/cli.js\" \"$@\"\n"
const windowsShim = "@echo off\r\nnode \"%~dp0cli.js\" %*\r\n"
const stagedTopLevelEntries = ["cli.js", "directive.md", "omo-agent-toolkit", "omo-agent-toolkit.cmd", "ulw-loop"]
const stagedArtifactPaths = ["cli.js", "directive.md", join("ulw-loop", "cli.js"), "omo-agent-toolkit", "omo-agent-toolkit.cmd"]

export async function stageAgentToolkit(options = {}) {
  const sourceEntry = resolve(options.sourceEntry ?? defaultSourceEntry)
  const directiveEntry = resolve(options.directiveEntry ?? defaultDirectiveEntry)
  const targetDir = resolve(options.targetDir ?? defaultTargetDir)
  const platform = options.platform ?? process.platform
  const copyDirectory = options.copyDirectory ?? cp
  if (options.buildBundle !== false) await buildAggregateBundle()
  await validateFile(sourceEntry, "aggregate ulw-loop bundle")
  await validateFile(directiveEntry, "ulw-loop directive")

  await mkdir(dirname(targetDir), { recursive: true })
  const tempParent = await mkdtemp(join(dirname(targetDir), ".tmp-omo-senpi-agent-toolkit-"))
  const tempDir = join(tempParent, "agent-toolkit")
  const backupDir = `${targetDir}.backup-${process.pid}-${Date.now()}`
  let backupCreated = false
  let targetMoved = false

  try {
    await mkdir(join(tempDir, "ulw-loop"), { recursive: true })
    await copyFile(sourceEntry, join(tempDir, "ulw-loop", "cli.js"))
    await copyFile(directiveEntry, join(tempDir, "directive.md"))
    await writeFile(join(tempDir, "cli.js"), dispatcher, "utf8")
    await writeFile(join(tempDir, "omo-agent-toolkit"), posixShim, "utf8")
    await writeFile(join(tempDir, "omo-agent-toolkit.cmd"), windowsShim, "utf8")
    await chmod(join(tempDir, "omo-agent-toolkit"), 0o755)
    await probeSelfContainment(tempDir)

    if (await stagedToolkitMatches(tempDir, targetDir)) {
      return { ok: true, sourceEntry, directiveEntry, targetDir, sha256: await sha256(sourceEntry) }
    }
    if (await fileExists(targetDir)) {
      if (platform === "win32") {
        try {
          await copyDirectory(targetDir, backupDir, { recursive: true, force: true, verbatimSymlinks: true })
        } catch (error) {
          await rm(backupDir, { recursive: true, force: true })
          throw error
        }
        backupCreated = true
        await rm(targetDir, { recursive: true, force: true })
      } else {
        await rename(targetDir, backupDir)
        backupCreated = true
      }
    }
    await rename(tempDir, targetDir)
    targetMoved = true
    if (backupCreated) {
      await rm(backupDir, { recursive: true, force: true })
      backupCreated = false
    }
    return { ok: true, sourceEntry, directiveEntry, targetDir, sha256: await sha256(sourceEntry) }
  } catch (error) {
    if (!targetMoved && backupCreated) {
      await rm(targetDir, { recursive: true, force: true })
      await rename(backupDir, targetDir)
      backupCreated = false
    }
    throw error
  } finally {
    await rm(tempParent, { recursive: true, force: true })
  }
}

async function stagedToolkitMatches(tempDir, targetDir) {
  try {
    const [topLevelEntries, ulwLoopEntries] = await Promise.all([
      readdir(targetDir),
      readdir(join(targetDir, "ulw-loop")),
    ])
    if (topLevelEntries.toSorted().join("\n") !== stagedTopLevelEntries.join("\n")) return false
    if (ulwLoopEntries.join("\n") !== "cli.js") return false
    const matches = await Promise.all(
      stagedArtifactPaths.map((path) => filesEqual(join(tempDir, path), join(targetDir, path))),
    )
    if (!matches.every(Boolean)) return false
    return process.platform === "win32" || ((await stat(join(targetDir, "omo-agent-toolkit"))).mode & 0o777) === 0o755
  } catch (error) {
    if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR") || isErrno(error, "EISDIR")) return false
    throw error
  }
}

export async function checkAgentToolkitFresh(options = {}) {
  const sourceEntry = resolve(options.sourceEntry ?? defaultSourceEntry)
  const directiveEntry = resolve(options.directiveEntry ?? defaultDirectiveEntry)
  const targetDir = resolve(options.targetDir ?? defaultTargetDir)
  const paths = {
    dispatcher: join(targetDir, "cli.js"),
    directive: join(targetDir, "directive.md"),
    bundle: join(targetDir, "ulw-loop", "cli.js"),
    posix: join(targetDir, "omo-agent-toolkit"),
    windows: join(targetDir, "omo-agent-toolkit.cmd"),
  }
  await validateFile(sourceEntry, "aggregate ulw-loop bundle")
  await validateFile(directiveEntry, "ulw-loop directive")
  await Promise.all(Object.values(paths).map((path) => validateFile(path, "staged agent-toolkit artifact")))
  if (!(await readFile(paths.directive)).equals(await readFile(directiveEntry))) throw new Error(`agent-toolkit runtime stale: directive content differs: ${paths.directive}`)
  if (await readFile(paths.dispatcher, "utf8") !== dispatcher) throw new Error(`agent-toolkit runtime stale: dispatcher content differs: ${paths.dispatcher}`)
  if (await readFile(paths.posix, "utf8") !== posixShim) throw new Error(`agent-toolkit runtime stale: POSIX shim content differs: ${paths.posix}`)
  if (await readFile(paths.windows, "utf8") !== windowsShim) throw new Error(`agent-toolkit runtime stale: Windows shim content differs: ${paths.windows}`)
  if (process.platform !== "win32" && ((await stat(paths.posix)).mode & 0o777) !== 0o755) {
    throw new Error(`agent-toolkit runtime stale: POSIX shim is not mode 755: ${paths.posix}`)
  }
  const [sourceSha256, stagedSha256] = await Promise.all([sha256(sourceEntry), sha256(paths.bundle)])
  if (sourceSha256 !== stagedSha256) {
    throw new Error(`agent-toolkit runtime stale: staged ulw-loop sha256 ${stagedSha256} does not match built sha256 ${sourceSha256}`)
  }
  return { ok: true, sourceEntry, directiveEntry, targetDir, sha256: sourceSha256 }
}

async function buildAggregateBundle() {
  // The lockfile comparison alone is not enough: a pruned or partially installed tree can match the lock
  // and still be missing the compiler the component build shells out to.
  const compiler = join(codexPluginRoot, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc")
  const needsInstall = !(await filesEqual(packageLock, installedPackageLock)) || !(await fileExists(compiler))
  if (needsInstall) {
    // The root `bun install` links this plugin's workspaces before its prepare script reaches this
    // build, and `npm ci` aborts on those pre-existing links with
    // `EEXIST: file already exists, symlink '../../components/teammode'` rather than replacing them.
    // Removing the tree first makes the install deterministic whoever populated it.
    await rm(codexPluginNodeModules, { recursive: true, force: true })
    run("npm", ["--prefix", "packages/omo-codex/plugin", "ci"])
  }
  // Only the ulw-loop bundle is staged here. Building every codex component instead would couple this
  // staging step to unrelated components, and one of them failing to emit its dist takes the whole
  // senpi plugin build down with it.
  run("npm", ["--prefix", "packages/omo-codex/plugin", "run", "--workspace", "components/ulw-loop", "build"])
  // The component build only runs tsc, whose output still imports its siblings by relative path. The
  // staged runtime is copied out on its own, so it has to be bundled into a single self-contained file
  // exactly like build-components.mjs does after each component build.
  run("bun", [
    "build",
    join(codexPluginRoot, "components", "ulw-loop", "src", "cli.ts"),
    "--target",
    "node",
    "--format",
    "esm",
    "--outfile",
    defaultSourceEntry,
  ])
}

async function probeSelfContainment(targetDir) {
  const cwd = await mkdtemp(join(tmpdir(), "omo-senpi-agent-toolkit-probe-"))
  const artifact = join(targetDir, "cli.js")
  try {
    const result = spawnSync(process.execPath, [artifact, "ulw-loop", "--help"], { cwd, encoding: "utf8" })
    if (result.stdout.length > 0) process.stdout.write(result.stdout)
    if (result.stderr.length > 0) process.stderr.write(result.stderr)
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`Self-containment probe failed for ${artifact} with exit code ${result.status ?? 1}`)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, shell: process.platform === "win32", stdio: "inherit" })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`)
}

async function filesEqual(left, right) {
  try {
    const [leftBytes, rightBytes] = await Promise.all([readFile(left), readFile(right)])
    return leftBytes.equals(rightBytes)
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false
    throw error
  }
}

async function validateFile(path, label) {
  let value
  try {
    value = await stat(path)
  } catch (error) {
    if (isErrno(error, "ENOENT")) throw new Error(`Senpi ${label} is missing: ${path}`)
    throw error
  }
  if (!value.isFile()) throw new Error(`Senpi ${label} is not a file: ${path}`)
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex")
}

async function fileExists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false
    throw error
  }
}

function isErrno(error, code) {
  return error instanceof Error && "code" in error && error.code === code
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.includes("--check")) {
      // Fresh-checkout-safe: if the aggregate ulw-loop bundle was never built locally (its dist is a
      // gitignored build output), there is nothing to verify - CI covers the full build in its dedicated job.
      if (!(await fileExists(defaultSourceEntry))) {
        console.log(`runtime dist not built locally; skipping freshness check: ${defaultSourceEntry}`)
      } else {
        const result = await checkAgentToolkitFresh()
        console.log(`Senpi agent-toolkit runtime is current: ${result.targetDir} sha256=${result.sha256}`)
      }
    } else {
      const result = await stageAgentToolkit()
      console.log(`Staged Senpi agent-toolkit runtime: ${result.targetDir}`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
