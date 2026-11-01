import { spawn } from "node:child_process"
import { createHash, X509Certificate } from "node:crypto"
import * as fs from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { getCACertificates } from "node:tls"
import { selectEngineTrust, type EngineTrustFacts, type MacCertificate, type TrustCertificate } from "./engine-trust-policy"
import { readLinuxBundle, selectLinuxBundle, type LinuxBundleRead } from "./linux-trust-bundle"
import { decodeMacTrustHelperOutput } from "./macos-trust-helper"
import { readDefaultFileCandidates } from "./openssl-default-file"
import { selectOpenSslHashDirectory } from "./openssl-hash-dir"
import { decodeWindowsTrustHelperOutput, encodeBundledRootsForHelper, windowsTrustHelperEnvironment } from "./windows-trust-helper"
import type { FallbackReason, TrustDiagnosticEntry } from "./trust-diagnostics"

export interface TrustAcquisition {
  readonly certificates: readonly string[]
  readonly fallbackReason: FallbackReason | null
  readonly codes: readonly TrustDiagnosticEntry[]
}
export interface TrustAcquisitionOptions {
  readonly deadlineMs: number
  readonly platform: NodeJS.Platform
  readonly environment: NodeJS.ProcessEnv
  /** Digest comes from the embedded manifest whose helper was signed during release packaging. */
  readonly helper?: { readonly path: string; readonly sha256: string }
  readonly linux?: {
    osRelease(): Promise<string | null>
    available(): Promise<readonly string[]>
    read(path: string): Promise<LinuxBundleRead>
  }
  readonly deadline?: (expire: () => void, milliseconds: number) => () => void
}
const MAX_BYTES = 8 * 1024 * 1024
const linuxPaths = [
  "/etc/ssl/certs/ca-certificates.crt", "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
  "/etc/pki/tls/certs/ca-bundle.crt", "/etc/ssl/ca-bundle.pem", "/etc/ssl/cert.pem",
]
const fallback = (reason: FallbackReason, codes: readonly TrustDiagnosticEntry[] = []): TrustAcquisition =>
  ({ certificates: [], fallbackReason: reason, codes })
const hash = (algorithm: string, bytes: Uint8Array) => createHash(algorithm).update(bytes).digest("hex")

function factsOf(cert: X509Certificate): TrustCertificate {
  return {
    sha256: hash("sha256", cert.raw), sha1: hash("sha1", cert.raw), ca: cert.ca,
    selfSigned: cert.checkIssued(cert) && cert.verify(cert.publicKey),
    eku: cert.keyUsage === undefined ? { kind: "unrestricted" } : { kind: "oids", oids: cert.keyUsage },
  }
}
function selected(facts: EngineTrustFacts, der: ReadonlyMap<string, Uint8Array>, codes: TrustDiagnosticEntry[]): TrustAcquisition {
  const result = selectEngineTrust(facts)
  codes.push(...result.diagnostics.map((code) => ({ code })))
  if (result.status === "failed") return fallback("negatives-incomplete", codes)
  return {
    certificates: [...result.S, ...result.I].map((id) => {
      const bytes = der.get(id)
      // A selected identity without its DER is a broken source; acquisition discards it as malformed.
      if (bytes === undefined) throw new Error("selected certificate has no DER")
      return new X509Certificate(bytes).toString()
    }),
    fallbackReason: null, codes,
  }
}
async function linux(options: TrustAcquisitionOptions): Promise<TrustAcquisition> {
  const sources = options.linux ?? {
    osRelease: async () => {
      for (const path of ["/etc/os-release", "/usr/lib/os-release"]) {
        try { return await fs.readFile(path, "utf8") } catch {}
      }
      return null
    },
    available: async () => (await Promise.all(linuxPaths.map(async (path) =>
      await fs.stat(path).then((s) => s.isFile(), () => false) ? path : null))).filter((path): path is string => path !== null),
    read: (path: string) => readLinuxBundle(path, fs),
  }
  const [release, paths] = await Promise.all([sources.osRelease(), sources.available()])
  const selection = selectLinuxBundle(release, null, (path) => paths.includes(path))
  if (selection.kind === "linux-bundle-absent") return fallback("linux-bundle-unreadable", [{ code: "linux-bundle-absent" }])
  const read = await sources.read(selection.path)
  if (read.kind !== "success") return fallback("linux-bundle-unreadable", [{ code: read.kind }])
  const parsed = readDefaultFileCandidates(read.bytes, () => false)
  if (parsed.kind === "dropped") return fallback("linux-bundle-malformed")
  const certificates = parsed.certificates.map(({ der }) => new X509Certificate(der))
  return selected({ os: "linux", complete: true, certificates: certificates.map(factsOf) },
    new Map(certificates.map((cert) => [hash("sha256", cert.raw), cert.raw])), [])
}

/** One killable helper, clean explicit environment, bounded output, never synchronous store calls. */
async function helperOutput(options: TrustAcquisitionOptions, signal: AbortSignal):
Promise<{ bytes: Uint8Array } | { reason: FallbackReason }> {
  const helper = options.helper
  if (!helper || !isAbsolute(helper.path)) return { reason: "helper-missing" }
  try {
    const stat = await fs.lstat(helper.path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) return { reason: "helper-signature" }
    if (hash("sha256", await fs.readFile(helper.path)) !== helper.sha256) return { reason: "helper-signature" }
  } catch { return { reason: "helper-missing" } }
  if (signal.aborted) return { reason: "helper-timeout" }
  const windows = options.platform === "win32"
  const env = windows ? windowsTrustHelperEnvironment(options.environment)
    : options.environment.HOME === undefined ? {} : { HOME: options.environment.HOME }
  return new Promise((resolve) => {
    const child = spawn(helper.path, [], { env, detached: true, stdio: ["pipe", "pipe", "ignore"], windowsHide: true })
    const chunks: Buffer[] = []
    let length = 0
    let done = false
    const kill = () => {
      if (child.pid === undefined) return
      if (windows) { child.kill("SIGKILL"); return }
      try { process.kill(-child.pid, "SIGKILL") } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) child.kill("SIGKILL")
      }
    }
    const settle = (result: { bytes: Uint8Array } | { reason: FallbackReason }) => {
      if (done) return
      done = true
      signal.removeEventListener("abort", aborted)
      resolve(result)
    }
    const aborted = () => { kill(); settle({ reason: "helper-timeout" }) }
    signal.addEventListener("abort", aborted, { once: true })
    if (signal.aborted) { aborted(); return }
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length
      if (length > MAX_BYTES) { kill(); settle({ reason: "helper-malformed-output" }) } else chunks.push(chunk)
    })
    child.on("error", (error: NodeJS.ErrnoException) => {
      const reason = error.code === "EACCES" ? "access-denied"
        : ["ENOENT", "ENOTDIR"].includes(error.code ?? "") ? "helper-missing"
          : ["ENOEXEC", "EBADARCH"].includes(error.code ?? "") ? "helper-wrong-arch" : "helper-crash"
      settle({ reason })
    })
    child.on("close", (code) => settle(code === 0 ? { bytes: Buffer.concat(chunks) }
      : { reason: code === 75 ? "helper-timeout" : code === 74 ? "helper-malformed-output" : "helper-crash" }))
    child.stdin.on("error", () => {}) // An early helper exit is classified by close/error, not EPIPE.
    child.stdin.end(windows ? encodeBundledRootsForHelper(getCACertificates("bundled").map((pem) => new X509Certificate(pem).raw)) : undefined)
  })
}

async function native(options: TrustAcquisitionOptions, signal: AbortSignal): Promise<TrustAcquisition> {
  const output = await helperOutput(options, signal)
  if ("reason" in output) return fallback(output.reason)
  const decoded = options.platform === "win32" ? decodeWindowsTrustHelperOutput(output.bytes) : decodeMacTrustHelperOutput(output.bytes)
  if (decoded.kind !== "decoded") return fallback("helper-malformed-output")
  const { facts } = decoded.document
  if (!facts.complete) return fallback(decoded.document.sources.some((source) => source.outcome === "access-denied")
    ? "access-denied" : "negatives-incomplete")
  const der = new Map(decoded.document.der)
  const codes: TrustDiagnosticEntry[] = []
  if (facts.os !== "macos") return selected(facts, der, codes)

  // macOS's implicit OpenSSL inputs remain sources, but never bypass the OS deny snapshot.
  const certificates: MacCertificate[] = [...facts.certificates]
  const add = (cert: X509Certificate, source: MacCertificate["source"]) => {
    const fact = factsOf(cert)
    der.set(fact.sha256, cert.raw)
    certificates.push({ ...fact, source, settings: { user: null, admin: null, system: null } })
  }
  const file = await readLinuxBundle("/etc/ssl/cert.pem", fs)
  if (file.kind === "success") {
    const parsed = readDefaultFileCandidates(file.bytes, () => false)
    if (parsed.kind === "kept") {
      for (const { der: bytes } of parsed.certificates) add(new X509Certificate(bytes), "openssl-default-file")
    } else codes.push({ code: "openssl-default-file-malformed" }, { code: parsed.cause })
  } else codes.push({ code: "openssl-default-file-malformed" })
  if (signal.aborted) return fallback("helper-timeout")
  const directory = "/etc/ssl/certs"
  const hashed = await selectOpenSslHashDirectory({
    entries: () => fs.readdir(directory),
    open: (name) => fs.open(join(directory, name), "r"),
  })
  codes.push(...hashed.diagnostics.map(({ code }) => ({ code })))
  const excluded = new Set(hashed.excludedFingerprints)
  const allowed = certificates.filter((cert) => {
    if (cert.source !== "openssl-default-file") return true
    const bytes = der.get(cert.sha256)
    return bytes !== undefined && !excluded.has(new X509Certificate(bytes).fingerprint256)
  })
  for (const cert of hashed.candidates) {
    const fact = factsOf(cert)
    der.set(fact.sha256, cert.raw)
    allowed.push({ ...fact, source: "openssl-default-dir", settings: { user: null, admin: null, system: null } })
  }
  return selected({ ...facts, certificates: allowed }, der, codes)
}

/** A timeout discards all automatic output; a late source can never publish a partial generation. */
export async function acquireEngineTrust(options: TrustAcquisitionOptions): Promise<TrustAcquisition> {
  const controller = new AbortController()
  let cancel = () => {}
  const timeout = new Promise<TrustAcquisition>((resolve) => {
    const expire = () => { controller.abort(); resolve(fallback("helper-timeout")) }
    cancel = options.deadline ? options.deadline(expire, Math.min(options.deadlineMs, 20_000)) : (() => {
      const timer = setTimeout(expire, Math.min(options.deadlineMs, 20_000))
      return () => clearTimeout(timer)
    })()
  })
  try {
    const work = options.platform === "linux" ? linux(options)
      : ["darwin", "win32"].includes(options.platform) ? native(options, controller.signal)
        : Promise.resolve(fallback("helper-missing"))
    return await Promise.race([work.catch(() => fallback(options.platform === "linux" ? "linux-bundle-malformed" : "helper-malformed-output")), timeout])
  } finally { cancel() }
}
