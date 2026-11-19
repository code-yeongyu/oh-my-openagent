#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

// The published payload is the only artifact a user installs, and `npm pack --dry-run` cannot prove
// it installs: oh-my-openagent@5.0.0-beta.43 shipped without the prompts-core directive and
// lazycodex-ai@5.0.0-beta.43 without shared-skills/skill-source-filter.mjs, and both died at
// `npm run sync:skills` on first install while every gate stayed green.
const REQUIRED_INSTALLED_ARTIFACTS = [
  join(".codex-plugin", "plugin.json"),
  join("skills", "ultrawork", "SKILL.md"),
  join("package.json"),
]

export function findMissingInstalledArtifacts(pluginPath) {
  return REQUIRED_INSTALLED_ARTIFACTS.filter((relativePath) => !existsSync(join(pluginPath, relativePath)))
}

export function parseSmokeArgs(argv) {
  const args = { packageSpec: null, tarballPath: null, keep: false }
  for (const argument of argv) {
    if (argument === "--keep") args.keep = true
    else if (argument.startsWith("--package=")) args.packageSpec = argument.slice("--package=".length)
    else if (argument.startsWith("--tarball=")) args.tarballPath = argument.slice("--tarball=".length)
  }
  return args
}

// Windows cannot spawn npm.cmd without a shell, and a shell turns the spec into a command line, so
// the spec is constrained to a package specifier before it is ever passed down.
const PACKAGE_SPEC_PATTERN = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:@[\w.-]+)?$/i

export function isSupportedPackageSpec(packageSpec) {
  return PACKAGE_SPEC_PATTERN.test(packageSpec)
}

const REGISTRY = "https://registry.npmjs.org"
const PROBE_TIMEOUT_MS = 15_000

/** The registry URL of one version's tarball; a scoped package keeps its scope only in the path prefix. */
export function registryTarballUrl(name, version) {
  const bareName = name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name
  return `${REGISTRY}/${name}/-/${bareName}-${version}.tgz`
}

function resolveDistTagVersion(name, tag) {
  return execFileSync("npm", ["view", `${name}@${tag}`, "version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    shell: process.platform === "win32",
  }).trim()
}

// npm moves the `latest` dist-tag before the new version's tarball is committed: right after 5.1.78
// published, `latest` pointed at it while its tarball answered 404 for about three minutes (#14257), so
// `npm pack <pkg>@latest` failed on a half-published window. The spec is resolved to latest's version,
// that exact tarball is waited for (bounded), and the exact version is packed, so the artifact checked
// is the artifact installed even if `latest` moves again in between.
export async function resolveCommittedLatestSpec(
  packageSpec,
  {
    deadlineMs,
    delayMs,
    viewVersion = resolveDistTagVersion,
    fetchImpl = fetch,
    now = Date.now,
    sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
    log = console.log,
  },
) {
  const at = packageSpec.lastIndexOf("@")
  if (at <= 0 || packageSpec.slice(at + 1) !== "latest") return packageSpec
  const name = packageSpec.slice(0, at)
  const version = viewVersion(name, "latest")
  if (!isSupportedPackageSpec(`${name}@${version}`)) {
    throw new Error(`npm view ${packageSpec} version returned an unrecognized version: ${JSON.stringify(version)}`)
  }
  const url = registryTarballUrl(name, version)
  const start = now()
  for (;;) {
    let reason
    try {
      const response = await fetchImpl(url, {
        method: "HEAD",
        headers: { "Cache-Control": "no-cache" },
        cache: "no-store",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      if (response.status === 200) {
        log(`${name}@latest is ${version}; tarball committed after ${Math.round((now() - start) / 1000)} s`)
        return `${name}@${version}`
      }
      reason = String(response.status)
    } catch (error) {
      reason = `probe failed (${error instanceof Error ? error.message : String(error)})`
    }
    const elapsed = now() - start
    const remaining = deadlineMs - elapsed
    if (remaining <= 0) {
      const waited = elapsed < 60_000 ? `${Math.round(elapsed / 1000)} s` : `${Math.floor(elapsed / 60_000)} min`
      throw new Error(`registry not committed: ${name}@${version} tarball ${reason} for ${waited}`)
    }
    log(`${name}@latest is ${version}; tarball ${reason}, ${Math.round(remaining / 1000)} s left`)
    await sleep(Math.min(delayMs, remaining))
  }
}

// A non-numeric override would make the deadline NaN, which `remaining <= 0` never reaches, so the
// smoke would poll forever; a bad value fails by name instead of falling back silently.
export function registryWaitFromEnv(env) {
  const seconds = (key, fallback) => {
    const raw = env[key]
    if (raw === undefined) return fallback
    const value = raw.trim() === "" ? Number.NaN : Number(raw)
    if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid ${key}: ${raw}`)
    return value
  }
  return {
    deadlineMs: seconds("PUBLISHED_SMOKE_REGISTRY_WAIT_SECONDS", 1200) * 1000,
    delayMs: seconds("PUBLISHED_SMOKE_REGISTRY_POLL_SECONDS", 15) * 1000,
  }
}

function packPublishedTarball(packageSpec, workingDirectory) {
  if (!isSupportedPackageSpec(packageSpec)) {
    throw new Error(`refusing to pack an unrecognized package spec: ${packageSpec}`)
  }
  execFileSync("npm", ["pack", packageSpec, "--silent"], {
    cwd: workingDirectory,
    stdio: ["ignore", "inherit", "inherit"],
    shell: process.platform === "win32",
  })
}

async function extractTarball(tarballPath, workingDirectory) {
  const extractedRoot = join(workingDirectory, "extracted")
  await mkdir(extractedRoot, { recursive: true })
  execFileSync("tar", ["-xzf", tarballPath, "-C", extractedRoot], { stdio: ["ignore", "inherit", "inherit"] })
  return join(extractedRoot, "package")
}

async function runSmoke(argv) {
  const args = parseSmokeArgs(argv)
  if (args.packageSpec === null && args.tarballPath === null) {
    console.error("usage: node script/published-install-smoke.mjs --package=<spec> | --tarball=<path> [--keep]")
    return 2
  }

  const sandbox = await mkdtemp(join(tmpdir(), "omo-published-smoke-"))
  // The sandbox is always created here and never taken from the environment, so a caller's real
  // CODEX_HOME can never be written by this smoke.
  const codexHome = join(sandbox, "codex-home")
  const binDir = join(sandbox, "bin")
  await mkdir(codexHome, { recursive: true })
  await mkdir(binDir, { recursive: true })

  try {
    let tarballPath = args.tarballPath === null ? null : resolve(args.tarballPath)
    if (tarballPath === null) {
      const packageSpec = await resolveCommittedLatestSpec(args.packageSpec, registryWaitFromEnv(process.env))
      packPublishedTarball(packageSpec, sandbox)
      const packed = (await readdir(sandbox)).filter((entry) => entry.endsWith(".tgz"))
      if (packed.length !== 1) {
        console.error(`npm pack ${args.packageSpec} produced ${packed.length} tarballs; expected exactly 1`)
        return 1
      }
      tarballPath = join(sandbox, packed[0])
    }

    const packageRoot = await extractTarball(tarballPath, sandbox)
    const installerPath = join(packageRoot, "packages", "omo-codex", "scripts", "install-dist", "install-local.mjs")
    if (!existsSync(installerPath)) {
      console.error(`published payload has no Codex installer at ${installerPath}`)
      return 1
    }

    const installer = await import(pathToFileURL(installerPath).href)
    const result = await installer.installMarketplaceLocally({
      repoRoot: packageRoot,
      autonomousPermissions: true,
      env: { ...process.env, CODEX_HOME: codexHome, CODEX_LOCAL_BIN_DIR: binDir },
      log: (message) => console.log(`[smoke] ${message}`),
    })

    const pluginPath = result.installed[0]?.path
    if (pluginPath === undefined) {
      console.error("published payload installed no plugin")
      return 1
    }

    const missing = findMissingInstalledArtifacts(pluginPath)
    if (missing.length > 0) {
      console.error(`installed plugin is missing ${missing.length} required artifact(s):`)
      for (const relativePath of missing) console.error(`  ${relativePath}`)
      return 1
    }

    console.log(`published install smoke OK (${result.installed.length} plugin(s), ${pluginPath})`)
    return 0
  } catch (error) {
    console.error(`published install smoke failed: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  } finally {
    if (!args.keep) await rm(sandbox, { recursive: true, force: true })
  }
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(resolve(process.argv[1])).href
if (invokedPath === import.meta.url) {
  process.exitCode = await runSmoke(process.argv.slice(2))
}
