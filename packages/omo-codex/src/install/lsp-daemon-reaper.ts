import { createHash } from "node:crypto"
import { lstat, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, posix } from "node:path"

import { attestLegacyDaemonOwnership, probeLegacyJsonRpcEndpoint, type LegacyDaemonAttestationInput } from "./lsp-daemon-reaper-attestation"

const LEGACY_EXIT_WAIT_TIMEOUT_MS = 5_000
const LEGACY_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/

export interface LegacyDaemonCleanupResult {
  readonly version: string
  readonly status: "removed" | "terminated" | "deferred"
  readonly reason: string
}

export interface ReapLspDaemonsDeps {
  readonly platform?: NodeJS.Platform
  readonly tmpDir?: string
  readonly probeLegacyJsonRpc?: (endpoint: string) => Promise<boolean>
  readonly attestLegacyDaemonOwnership?: (input: LegacyDaemonAttestationInput) => Promise<boolean>
  readonly killProcess?: (pid: number) => boolean
  readonly waitForProcessExit?: (pid: number, timeoutMs: number) => Promise<boolean>
}

export async function reapLspDaemons(
  codexHome: string,
  deps: ReapLspDaemonsDeps = {},
): Promise<readonly LegacyDaemonCleanupResult[]> {
  const daemonRoot = join(codexHome, "codex-lsp", "daemon")
  const platform = deps.platform ?? process.platform
  const tmpDir = deps.tmpDir ?? tmpdir()
  const probe = deps.probeLegacyJsonRpc ?? probeLegacyJsonRpcEndpoint
  const attest = deps.attestLegacyDaemonOwnership ?? ((input) => attestLegacyDaemonOwnership(input))
  const killProcess = deps.killProcess ?? sendSigterm
  const waitForProcessExit = deps.waitForProcessExit ?? defaultWaitForProcessExit

  const entries = await readdir(daemonRoot, { withFileTypes: true }).catch(() => [])
  const results: LegacyDaemonCleanupResult[] = []
  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    const versionPath = join(daemonRoot, entry.name)
    const parsedVersion = parseVersionEntry(entry.name)
    if (parsedVersion === null || !entry.isDirectory()) {
      await removeVersionDir(versionPath)
      results.push(removed(entry.name, "removed invalid legacy version entry"))
      continue
    }

    const metadata = await readLegacyMetadata({ versionPath, version: parsedVersion, codexHome, platform, tmpDir })
    if (metadata.kind === "remove") {
      await removeVersionDir(versionPath)
      results.push(removed(parsedVersion, metadata.reason))
      continue
    }

    if (!(await probe(metadata.endpoint))) {
      await removeVersionDir(versionPath)
      results.push(removed(parsedVersion, "removed stale legacy daemon state"))
      continue
    }

    if (platform === "win32") {
      results.push(deferred(parsedVersion, "legacy named pipe responded but Windows cannot prove pid ownership safely"))
      continue
    }

    const owned = await attest({ pid: metadata.pid, endpoint: metadata.endpoint, platform })
    if (!owned) {
      results.push(deferred(parsedVersion, "legacy endpoint responded but pid ownership was not proven"))
      continue
    }

    if (!killProcess(metadata.pid)) {
      await removeVersionDir(versionPath)
      results.push(removed(parsedVersion, "removed stale legacy daemon state"))
      continue
    }

    if (!(await waitForProcessExit(metadata.pid, LEGACY_EXIT_WAIT_TIMEOUT_MS))) {
      results.push(deferred(parsedVersion, `timed out waiting ${LEGACY_EXIT_WAIT_TIMEOUT_MS}ms for the proven legacy daemon to exit`))
      continue
    }

    await removeVersionDir(versionPath)
    results.push(terminated(parsedVersion, "terminated proven owned legacy daemon"))
  }

  return results
}

function parseVersionEntry(entryName: string): string | null {
  if (!entryName.startsWith("v")) return null
  const version = entryName.slice(1)
  return LEGACY_VERSION_PATTERN.test(version) ? version : null
}

async function readLegacyMetadata(input: {
  readonly versionPath: string
  readonly version: string
  readonly codexHome: string
  readonly platform: NodeJS.Platform
  readonly tmpDir: string
}): Promise<
  | { readonly kind: "valid"; readonly pid: number; readonly endpoint: string }
  | { readonly kind: "remove"; readonly reason: string }
> {
  const pidText = await readRegularTrimmedFile(join(input.versionPath, "daemon.pid"))
  if (pidText === "non_regular") return { kind: "remove", reason: "removed non-regular legacy daemon metadata" }
  if (pidText === null) return { kind: "remove", reason: "removed malformed legacy daemon metadata" }
  const pid = Number.parseInt(pidText, 10)
  if (!Number.isInteger(pid) || pid <= 0) return { kind: "remove", reason: "removed malformed legacy daemon metadata" }

  const endpointText = await readRegularTrimmedFile(join(input.versionPath, "daemon.endpoint"))
  if (endpointText === "non_regular") return { kind: "remove", reason: "removed non-regular legacy daemon metadata" }
  if (endpointText === null) return { kind: "remove", reason: "removed malformed legacy daemon metadata" }
  const allowedEndpoints = legacyEndpointCandidates({
    version: input.version,
    versionPath: input.versionPath,
    platform: input.platform,
    tmpDir: input.tmpDir,
  })
  if (!allowedEndpoints.includes(endpointText)) {
    return { kind: "remove", reason: "removed legacy daemon state with an endpoint outside the frozen vectors" }
  }

  return { kind: "valid", pid, endpoint: endpointText }
}

function legacyEndpointCandidates(input: {
  readonly version: string
  readonly versionPath: string
  readonly platform: NodeJS.Platform
  readonly tmpDir: string
}): readonly string[] {
  if (input.platform === "win32") {
    const normalizedVersionPath = input.versionPath.replaceAll("/", "\\")
    const digest = shortDigest(normalizedVersionPath)
    return [`\\\\.\\pipe\\omo-lsp-${input.version}-${digest}`]
  }

  const natural = posix.join(input.versionPath, "daemon.sock")
  const hashed = posix.join(input.tmpDir, `omo-lsp-${input.version}-${shortDigest(input.versionPath)}.sock`)
  return [natural, hashed]
}

async function readRegularTrimmedFile(path: string): Promise<string | "non_regular" | null> {
  const stats = await lstat(path).catch(() => null)
  if (stats === null) return null
  if (!stats.isFile()) return "non_regular"
  const content = (await readFile(path, "utf8")).trim()
  return content.length > 0 ? content : null
}

function shortDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

async function removeVersionDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

function removed(version: string, reason: string): LegacyDaemonCleanupResult {
  return { version, status: "removed", reason }
}

function terminated(version: string, reason: string): LegacyDaemonCleanupResult {
  return { version, status: "terminated", reason }
}

function deferred(version: string, reason: string): LegacyDaemonCleanupResult {
  return { version, status: "deferred", reason }
}

function sendSigterm(pid: number): boolean {
  try {
    process.kill(pid, "SIGTERM")
    return true
  } catch {
    return false
  }
}

async function defaultWaitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (!processIsRunning(pid)) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
