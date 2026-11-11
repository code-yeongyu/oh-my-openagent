import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { releaseAssetName, releaseVersionOf, RELEASES_URL } from "./compiled-update"
import { type EmbeddedManifest } from "./compile-runtime"
import { type Generation, type UpdateStore } from "./update-store"

// Adapted from #11070's checksumFor/swapReleaseBinary. Publication is deliberately
// separate: neither the downloaded bootstrap nor a live runtime is overwritten.
function releaseChecksum(sums: string, asset: string): string {
  const entries = sums.split(/\r?\n/).map((line) => /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim()))
    .filter((entry) => entry !== null && entry[2] === asset)
  if (entries.length !== 1) throw new Error(`Release must list exactly one checksum for ${asset}`)
  return entries[0]![1]
}

export function verifyChecksum(bytes: Uint8Array, sums: string, asset: string): string {
  const expected = releaseChecksum(sums, asset)
  const digest = createHash("sha256").update(bytes).digest("hex")
  if (digest !== expected) throw new Error(`Download does not match the published checksum for ${asset}`)
  return digest
}

/** Probes inherit TLS settings, but no credentials, extensions or runtime/worker markers. */
export function updateProbeEnvironment(home: string, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "OMO_EXTRA_CA_CERTIFICATES"]) {
    if (source[key] !== undefined) env[key] = source[key]
  }
  Object.assign(env, {
    HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "data"),
    XDG_CACHE_HOME: join(home, "cache"), XDG_STATE_HOME: join(home, "state"),
    OMO_CODING_AGENT_DIR: join(home, "agent"), SENPI_CODING_AGENT_DIR: join(home, "agent"),
    PI_CODING_AGENT_DIR: join(home, "agent"), OMO_AUTO_UPDATE: "off", OMO_OFFLINE: "1",
    OMO_SKIP_VERSION_CHECK: "1",
  })
  return env
}

function runProbe(executable: string, args: string[], env: NodeJS.ProcessEnv, rpc = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, cwd: env.HOME, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })
    let output = ""
    let failure: Error | undefined
    let ready = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
      child.kill("SIGTERM")
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 1000)
    }
    const timeout = setTimeout(() => { failure = new Error("Candidate startup probe timed out"); stop() }, 30_000)
    child.once("error", (error) => { failure = error })
    child.stdin.on("error", (error) => { if (!ready) failure = error })
    child.stderr.on("data", () => { /* Do not retain potentially sensitive engine diagnostics. */ })
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString()
      if (output.length > 2 * 1024 * 1024) { failure = new Error("Candidate probe exceeded output limit"); stop(); return }
      if (!rpc || ready) return
      for (const line of output.split("\n").slice(0, -1)) {
        try {
          const reply = JSON.parse(line)
          if (reply.id === "omo-update-preflight" && reply.type === "response" && reply.command === "get_state" && reply.success === true) {
            ready = true
            stop()
            break
          }
        } catch { /* Non-protocol startup lines do not prove readiness. */ }
      }
    })
    child.once("close", (status) => {
      clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      if (failure) reject(failure)
      else if (rpc ? ready : status === 0) resolve(output)
      else reject(new Error(rpc ? "Candidate engine did not answer get_state" : `Candidate probe exited ${status}`))
    })
    child.stdin.end(rpc ? '{"id":"omo-update-preflight","type":"get_state"}\n' : undefined)
  })
}

export async function preflightGeneration(directory: string, generation: Generation): Promise<void> {
  const home = join(directory, "..", "..", "staging", `probe-${crypto.randomUUID()}`)
  await mkdir(home, { recursive: true, mode: 0o700 })
  try {
    await runProbe(join(directory, generation.asset.endsWith(".exe") ? "omo.exe" : "omo"),
      ["--mode", "rpc", "--no-session"], updateProbeEnvironment(home), true)
  } finally { await rm(home, { recursive: true, force: true }) }
}

type DownloadOptions = {
  store: UpdateStore
  version: string
  asset: string
  platform: NodeJS.Platform
  arch: string
  releaseBase?: string
  fetch?: typeof fetch
  retry?: boolean
}

export async function downloadGeneration(options: DownloadOptions): Promise<{ staging: string; generation: Generation }> {
  const download = options.fetch ?? fetch
  const base = `${options.releaseBase ?? RELEASES_URL}/download/v${options.version}`
  const get = async (name: string) => {
    const response = await download(`${base}/${name}`, { headers: { "User-Agent": "omo" }, signal: AbortSignal.timeout(600_000) })
    if (!response.ok) throw new Error(`${name} download answered ${response.status}`)
    return response
  }
  const sums = await (await get("SHA256SUMS")).text()
  const expected = releaseChecksum(sums, options.asset)
  const quarantined = (await options.store.read())?.quarantine[`${options.version}-${options.asset}-${expected}`]
  if (quarantined && !options.retry) throw new Error(`Candidate quarantined: ${quarantined}`)
  const bytes = new Uint8Array(await (await get(options.asset)).arrayBuffer())
  const digest = verifyChecksum(bytes, sums, options.asset)
  const staging = await options.store.createStaging()
  const probeHome = await options.store.createStaging()
  const downloaded = join(probeHome, options.asset.endsWith(".exe") ? "candidate.exe" : "candidate")
  try {
    await writeFile(downloaded, bytes, { mode: 0o700, flag: "wx" })
    await chmod(downloaded, 0o700)
    const env = updateProbeEnvironment(probeHome)
    const version = await runProbe(downloaded, ["--version"], env)
    if (!version.startsWith(`omo ${options.version} `) && version.trim() !== `omo ${options.version}`) {
      throw new Error("Candidate product version does not match the release")
    }
    const raw = await runProbe(downloaded, ["--omo-update-extract", staging], env)
    const manifest = JSON.parse(raw.trim()) as EmbeddedManifest & { updateProtocol?: number; updateBackwardCompatible?: boolean }
    if (releaseVersionOf(manifest.omoAiVersion) !== options.version
      || releaseAssetName(manifest.releaseTarget, options.platform, options.arch) !== options.asset
      || typeof manifest.releaseTarget !== "string" || typeof manifest.enginePin !== "string"
      || !/^[0-9a-f]{64}$/.test(manifest.manifestSha) || !Array.isArray(manifest.entries)) {
      throw new Error("Candidate embedded manifest does not match the release")
    }
    if (!Number.isSafeInteger(manifest.updateProtocol) || manifest.updateProtocol! < 1) throw new Error("Candidate has no bootstrap protocol declaration")
    const generation: Generation = {
      version: options.version, asset: options.asset, digest, protocol: manifest.updateProtocol!,
      backwardCompatible: manifest.updateBackwardCompatible === true,
      payloadDigest: createHash("sha256").update(await readFile(join(staging, "runtime-manifest.json"))).digest("hex"),
    }
    // Extraction has already validated every embedded entry. Recheck the copied executable.
    const executable = await readFile(join(staging, options.asset.endsWith(".exe") ? "omo.exe" : "omo"))
    verifyChecksum(executable, sums, options.asset)
    return { staging, generation }
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  } finally { await rm(probeHome, { recursive: true, force: true }) }
}
