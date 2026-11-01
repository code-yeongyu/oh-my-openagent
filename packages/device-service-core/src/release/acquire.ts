import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { posixSecureFile, type SecureFile } from "../local-api/access.ts"
import { currentUserSid, windowsSecureFile } from "../local-api/dacl.ts"
import { strictEd25519Key } from "../strict-ed25519/strict-ed25519.ts"
import {
  BINARY_MAX_BYTES,
  CHECKSUMS,
  CHECKSUMS_MAX_BYTES,
  type DeviceServiceHost,
  deviceServiceAssetName,
  MANIFEST,
  MANIFEST_MAX_BYTES,
  parseChecksums,
  parseManifest,
  SIGNATURE,
  SIGNATURE_BYTES,
} from "./release-assets.ts"
import { codeSignaturePasses, DEVICE_SERVICE_RELEASE_KEY, releaseKeyBytes, verifyReleaseSignature } from "./release-signature.ts"
import { compareVersions } from "./version.ts"

export { type DeviceServiceHost, deviceServiceAssetName } from "./release-assets.ts"
export { DEVICE_SERVICE_RELEASE_KEY, verifyReleaseSignature } from "./release-signature.ts"

const DEVICE_SERVICE_ORIGIN = "https://get.omo.dev"

export type FetchRelease = (url: string, init?: { readonly signal?: AbortSignal }) => Promise<Response>

export type AcquireOptions = {
  /** The device service version this omo build pins. */
  readonly version: string
  readonly host: DeviceServiceHost
  readonly stateDir: string
  /** The engine version bundled with this omo build, compared with the release's min_engine_version. */
  readonly engineVersion: string
  readonly channel?: string
  readonly origin?: string
  /** Hex release key; the compiled-in DEVICE_SERVICE_RELEASE_KEY by default. */
  readonly releaseKey?: string
  readonly fetch?: FetchRelease
  readonly verifyCodeSignature?: (path: string) => boolean
  readonly secure?: SecureFile
}

export type AcquireRefusal =
  | "release_key_invalid"
  | "download_failed"
  | "malformed"
  | "signature"
  | "checksum"
  | "version_mismatch"
  | "update_required"
  | "code_signature"

export type AcquireResult =
  | { readonly ok: true; readonly version: string; readonly releaseDir: string; readonly binary: string }
  | { readonly ok: false; readonly refusal: AcquireRefusal; readonly action: string }

const VERIFY_FAILED = "The downloaded OmO device service failed verification and was not installed. Try again later; if it keeps failing, report it with /bug."

const refuse = (refusal: AcquireRefusal, action = VERIFY_FAILED): AcquireResult => ({ ok: false, refusal, action })
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

const platformSecure: SecureFile =
  process.platform === "win32" ? async (path, kind) => windowsSecureFile(await currentUserSid())(path, kind) : posixSecureFile

type Download = Uint8Array | "missing" | "too_large"

const downloader = (fetchRelease: FetchRelease, base: string) => async (name: string, maxBytes: number): Promise<Download> => {
  let response: Response
  try {
    response = await fetchRelease(`${base}${name}`, { signal: AbortSignal.timeout(120_000) })
  } catch {
    return "missing"
  }
  if (!response.ok) return "missing"
  const declared = Number(response.headers.get("content-length") ?? "0")
  if (declared > maxBytes) return "too_large"
  const bytes = new Uint8Array(await response.arrayBuffer())
  return bytes.length > maxBytes ? "too_large" : bytes
}

const downloadRefusal = (download: "missing" | "too_large"): AcquireResult =>
  download === "missing"
    ? refuse("download_failed", "Could not download the OmO device service. Check the connection and try again.")
    : refuse("malformed")

// Writes the verified release into a staging dir beside its target, checks the macOS signature there, then renames it
// into place, so <state dir>/bin/<version> only ever holds a complete, verified release.
const install = async (
  options: AcquireOptions,
  files: ReadonlyMap<string, Uint8Array>,
  binaryName: string,
): Promise<AcquireResult> => {
  const secure = options.secure ?? platformSecure
  const bin = join(options.stateDir, "bin")
  for (const dir of [options.stateDir, bin]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    await secure(dir, "dir")
  }
  const staging = mkdtempSync(join(bin, ".staging-"))
  const releaseDir = join(bin, options.version)
  try {
    for (const [name, bytes] of files) writeFileSync(join(staging, name), bytes, { mode: 0o600 })
    chmodSync(join(staging, binaryName), 0o755)
    if (options.host.startsWith("darwin-") && !(options.verifyCodeSignature ?? codeSignaturePasses)(join(staging, binaryName)))
      return refuse("code_signature")
    const previous = existsSync(releaseDir) ? `${staging}.previous` : undefined
    if (previous !== undefined) renameSync(releaseDir, previous)
    renameSync(staging, releaseDir)
    if (previous !== undefined) rmSync(previous, { recursive: true, force: true })
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  return { ok: true, version: options.version, releaseDir, binary: join(releaseDir, binaryName) }
}

/**
 * Downloads one device service release and installs it into `<state dir>/bin/<version>/`. Every check runs before
 * anything is written: the compiled-in key, then the strict signature over checksums.txt, then each file's sha256,
 * then latest.json against the pinned version and the bundled engine.
 */
export const acquireDeviceService = async (options: AcquireOptions): Promise<AcquireResult> => {
  const key = releaseKeyBytes(options.releaseKey ?? DEVICE_SERVICE_RELEASE_KEY)
  if (key === undefined || !strictEd25519Key(key))
    return refuse("release_key_invalid", "This omo build cannot verify device service releases. Update OmO.")
  const get = downloader(
    options.fetch ?? globalThis.fetch,
    `${options.origin ?? DEVICE_SERVICE_ORIGIN}/${options.channel ?? "stable"}/device-service/${options.version}/`,
  )
  const [checksums, signature] = await Promise.all([get(CHECKSUMS, CHECKSUMS_MAX_BYTES), get(SIGNATURE, SIGNATURE_BYTES)])
  if (typeof checksums === "string") return downloadRefusal(checksums)
  if (typeof signature === "string") return downloadRefusal(signature)
  const verdict = await verifyReleaseSignature(key, signature, checksums)
  if (!verdict.ok) return refuse(verdict.refusal)
  const digests = parseChecksums(checksums)
  const binaryName = deviceServiceAssetName(options.host)
  const manifestDigest = digests?.get(MANIFEST)
  const binaryDigest = digests?.get(binaryName)
  if (manifestDigest === undefined || binaryDigest === undefined) return refuse("malformed")
  const [manifestBytes, binary] = await Promise.all([get(MANIFEST, MANIFEST_MAX_BYTES), get(binaryName, BINARY_MAX_BYTES)])
  if (typeof manifestBytes === "string") return downloadRefusal(manifestBytes)
  if (typeof binary === "string") return downloadRefusal(binary)
  if (sha256(manifestBytes) !== manifestDigest || sha256(binary) !== binaryDigest) return refuse("checksum")
  const manifest = parseManifest(manifestBytes)
  if (manifest === undefined) return refuse("malformed")
  if (manifest.version !== options.version) return refuse("version_mismatch")
  if (compareVersions(manifest.min_engine_version, options.engineVersion) > 0)
    return refuse(
      "update_required",
      `This OmO device service needs engine ${manifest.min_engine_version} or later. Update OmO, then try again.`,
    )
  const files = new Map([
    [CHECKSUMS, checksums],
    [SIGNATURE, signature],
    [MANIFEST, manifestBytes],
    [binaryName, binary],
  ])
  return install(options, files, binaryName)
}
