import { getCACertificates } from "node:tls"
import { dirname } from "node:path"
import {
  applyEngineTrustRestore, buildTrustLaunchEnvironment, classifyTrustArrival,
  recordAdoptedEngineTrust, type EngineTrustMarker, type EngineTrustRestore,
} from "@code-yeongyu/senpi/engine-trust"
import { parseExtraCaCertificates } from "./compiled-ca-trust"
import { trustLaunchKind } from "./compile-args"
import { reexecProvisionedRuntime } from "./provisioned-handoff"
import { appendTrustDiagnostic, type TrustDiagnosticEntry, type TrustDiagnosticInput } from "./trust-diagnostics"
import { acquireEngineTrust, type TrustAcquisition, type TrustAcquisitionOptions } from "./trust-acquisition"
import {
  certificateSet, createTrustDefaults, leaseTrustGeneration, prepareTrustDirectory, recoverUserExtras,
  retainTrustGeneration, temporaryTrustDirectory, trustDirectory, TrustStorageError, verifyTrustDefaults,
  verifyTrustGeneration, writeTrustGeneration,
} from "./trust-generation"

type Check = "file" | "loaded-set" | "provenance" | "extras"
type Refusal = "trust-load-mismatch" | "trust-exec-loop" | "trust-user-extras-unrecoverable" | "trust-path-unrepresentable"
export type TrustStageResult =
  | { readonly action: "static" | "adopt" | "import-exec" }
  | { readonly action: "refuse"; readonly code: Refusal; readonly check: Check | null }

export interface TrustStageOptions {
  readonly args: readonly string[]
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly directory?: string
  readonly executable?: string
  readonly argv?: string[]
  readonly helper?: TrustAcquisitionOptions["helper"]
  /** Fault seams are options only; no shipped flag or environment variable selects one. */
  readonly acquire?: (options: TrustAcquisitionOptions) => Promise<TrustAcquisition>
  readonly loadedExtra?: () => readonly string[]
  readonly exec?: (file: string, argv: string[], env: NodeJS.ProcessEnv) => Promise<void>
  readonly stderr?: (line: string) => void
}

function value(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  const entries = Object.entries(env).filter(([key, val]) => val !== undefined
    && (platform === "win32" ? key.toUpperCase() === name : key === name))
  return entries.length === 1 ? entries[0]?.[1] : undefined
}
function present(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): boolean {
  return Object.keys(env).some((key) => env[key] !== undefined && (platform === "win32" ? key.toUpperCase() === name : key === name))
}
const systemOption = (text: string | undefined) => /(?:^|[\s"'])--use-system-ca(?:$|[\s"'])/.test(text ?? "")
function optedIn(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  return ["NODE_USE_SYSTEM_CA", "SSL_CERT_FILE", "SSL_CERT_DIR"].some((name) => present(env, name, platform))
    || systemOption(value(env, "BUN_OPTIONS", platform))
}
function server(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  return present(env, "T3CODE_OMO_AGENT_DIR", platform) || present(env, "OMO_EXTRA_CA_CERTIFICATES", platform)
}
function restoreArrival(env: NodeJS.ProcessEnv, owner: EngineTrustMarker["owner"], platform: NodeJS.Platform): EngineTrustRestore {
  const restore: EngineTrustRestore = {}
  for (const name of ["NODE_EXTRA_CA_CERTS", "NODE_USE_SYSTEM_CA", "SSL_CERT_FILE", "SSL_CERT_DIR"] as const) {
    restore[name] = value(env, name, platform) ?? null
  }
  if (owner === "server") restore.BUN_OPTIONS = value(env, "BUN_OPTIONS", platform) ?? null
  return restore
}
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return JSON.stringify(certificateSet(a)) === JSON.stringify(certificateSet(b))
}

async function adoptionCheck(marker: EngineTrustMarker, env: NodeJS.ProcessEnv, platform: NodeJS.Platform,
  extras: readonly string[], loaded: () => readonly string[]): Promise<Check | null> {
  let parsed: Awaited<ReturnType<typeof verifyTrustGeneration>>
  try { parsed = await verifyTrustGeneration(marker) } catch { return "file" }
  if (marker.owner !== "server" && server(env, platform)) return "provenance"
  if (marker.defaults === null) {
    if (marker.owner !== "standalone" || !optedIn(env, platform)) return "provenance"
  } else {
    if (value(env, "SSL_CERT_FILE", platform) !== marker.defaults.file
      || value(env, "SSL_CERT_DIR", platform) !== marker.defaults.dir
      || present(env, "NODE_USE_SYSTEM_CA", platform) || systemOption(value(env, "BUN_OPTIONS", platform))) return "provenance"
    try { await verifyTrustDefaults(marker.defaults, platform) } catch { return "provenance" }
  }
  if (marker.owner === "server" && present(env, "BUN_OPTIONS", platform)) return "provenance"
  const selected = new Set(certificateSet(parsed.certificates))
  if (certificateSet(extras).some((identity) => !selected.has(identity))) return "extras"
  if (parsed.malformed || !sameSet(parsed.certificates, loaded())) return "loaded-set"
  return null
}

/** Design 5.2: hop is independent of marker classification, and only adoption bypasses it. */
export async function runTrustStage(options: TrustStageOptions): Promise<TrustStageResult> {
  const kind = trustLaunchKind(options.args)
  if (kind === "static") return { action: "static" }
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const arrival = classifyTrustArrival(env, platform)
  const addressed = arrival.marker.kind === "addressed" ? arrival.marker.marker : undefined
  const loaded = options.loadedExtra ?? (() => getCACertificates("extra"))
  const rawExtras = value(env, "OMO_EXTRA_CA_CERTIFICATES", platform)
  const extras = rawExtras ? parseExtraCaCertificates(rawExtras) : []
  const codes: TrustDiagnosticEntry[] = arrival.marker.kind === "foreign" ? [{ code: "trust-marker-foreign" }] : []
  let directory = options.directory ?? trustDirectory(env, platform)
  const record = async (input: TrustDiagnosticInput) => {
    // Diagnostics cannot widen trust or turn a safe refusal into dispatch.
    const unique = [...new Map(input.codes.map((entry) => [JSON.stringify(entry), entry])).values()]
    try { await appendTrustDiagnostic(directory, { ...input, codes: unique }) } catch {}
  }
  const refuse = async (code: Refusal, check: Check | null = null): Promise<TrustStageResult> => {
    await record({ kind, action: "refuse", generation: addressed?.sha256 ?? null, codes: [...codes, { code }], check })
    const action = code === "trust-user-extras-unrecoverable"
      ? "point NODE_EXTRA_CA_CERTS at your own CA file, or unset it, and start omo again"
      : code === "trust-path-unrepresentable"
        ? "set TMPDIR to a writable private path without the directory-list separator and start omo again"
        : "if SENPI_ENGINE_TRUST or SENPI_ENGINE_TRUST_HOP is saved in an environment you reuse, remove both and start omo again"
    ;(options.stderr ?? ((line) => process.stderr.write(line)))(`omo: ${code}${check ? ` (${check})` : ""}; ${action}\n`)
    return { action: "refuse", code, check }
  }
  const check = addressed === undefined ? null : await adoptionCheck(addressed, env, platform, extras, loaded)
  if (addressed !== undefined && check === null) {
    directory = dirname(addressed.file)
    codes.push(...await leaseTrustGeneration(addressed))
    recordAdoptedEngineTrust(addressed)
    applyEngineTrustRestore(env, addressed.restore, platform)
    if (codes.length) await record({ kind, action: "adopt", generation: addressed.sha256, codes })
    return { action: "adopt" }
  }
  // Create only the diagnostic sink before refusing; a hop never acquires or executes.
  try {
    const prepared = await prepareTrustDirectory(directory, platform)
    directory = prepared.directory
    codes.push(...prepared.codes)
  } catch (error) {
    if (error instanceof TrustStorageError) return refuse(error.code)
    throw error
  }
  if (arrival.hop) return refuse(addressed === undefined ? "trust-exec-loop" : "trust-load-mismatch", check)

  const owner = addressed?.owner ?? (server(env, platform) ? "server" : "standalone")
  const restore = addressed?.restore ?? restoreArrival(env, owner, platform)
  let user: Awaited<ReturnType<typeof recoverUserExtras>>
  try { user = await recoverUserExtras(value(env, "NODE_EXTRA_CA_CERTS", platform), loaded, addressed !== undefined) } catch (error) {
    if (error instanceof TrustStorageError) return refuse(error.code)
    throw error
  }
  if (user.recognized) codes.push({ code: "trust-generation-recognized" })
  const imported = await (options.acquire ?? acquireEngineTrust)({
    deadlineMs: kind === "one-shot-network" ? 20_000 : 1500, environment: env, platform, helper: options.helper,
  })
  codes.push(...imported.codes)
  if (imported.fallbackReason !== null) codes.push({ code: imported.fallbackReason })
  // Failed addressed adoption must use the writer's original opt-in, not its closure variables.
  const originals = addressed === undefined ? env : { ...env, ...Object.fromEntries(Object.entries(restore).map(([k, v]) => [k, v ?? undefined])) }
  let defaults: EngineTrustMarker["defaults"] = null
  if (owner === "server" || !optedIn(originals, platform)) {
    try { defaults = await createTrustDefaults(directory) } catch {
      try {
        directory = await temporaryTrustDirectory(platform)
        codes.push({ code: "trust-dir-unsafe" })
        defaults = await createTrustDefaults(directory)
      } catch { return refuse("trust-path-unrepresentable") }
    }
  } else {
    codes.push({ code: "trust-standalone-opt-in" })
  }
  const generation = await writeTrustGeneration(directory,
    imported.fallbackReason === null ? imported.certificates : [], extras, user.certificates)
  const marker: EngineTrustMarker = {
    v: 1, ...generation, automatic: imported.fallbackReason === null ? "os" : "fallback",
    fallbackReason: imported.fallbackReason, owner, restore, defaults,
  }
  codes.push(...await leaseTrustGeneration(marker))
  await retainTrustGeneration(marker)
  await record({ kind, action: "import-exec", generation: marker.sha256, codes })
  const next = buildTrustLaunchEnvironment(env, { marker, hop: true, platform })
  const exec = options.exec ?? ((file, argv, environment) => reexecProvisionedRuntime(file, { argv, env: environment, platform }))
  await exec(options.executable ?? process.execPath, options.argv ?? process.argv.slice(2), next)
  return { action: "import-exec" }
}
