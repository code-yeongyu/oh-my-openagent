import {
  CHECKSUMS,
  CHECKSUMS_MAX_BYTES,
  SIGNATURE,
  SIGNATURE_BYTES,
} from "./release-assets.ts"
import { DEVICE_SERVICE_ORIGIN, type FetchRelease } from "./acquire.ts"
import {
  DEVICE_SERVICE_RELEASE_KEYS,
  releaseKeySetBytes,
  verifyReleaseSignature,
} from "./release-signature.ts"

export type VerifyPinOptions = {
  /** The device service version this omo build pins. */
  readonly version: string
  readonly channel?: string
  readonly origin?: string
  /** Hex release key set, verified any-of; the compiled-in DEVICE_SERVICE_RELEASE_KEYS by default. */
  readonly releaseKeys?: readonly string[]
  readonly fetch?: FetchRelease
}

export type VerifyPinRefusal =
  | "release_key_invalid"
  | "not_published"
  | "download_failed"
  | "malformed"
  | "signature"

export type VerifyPinResult =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly refusal: VerifyPinRefusal; readonly message: string }

// "not_found" is an HTTP 404; "missing" is every other failed fetch (a throw, a timeout, a 5xx, another status).
type Download = Uint8Array | "not_found" | "missing" | "too_large"

const download = async (
  fetchRelease: FetchRelease,
  base: string,
  name: string,
  maxBytes: number,
): Promise<Download> => {
  let response: Response
  try {
    response = await fetchRelease(`${base}${name}`, { signal: AbortSignal.timeout(120_000) })
  } catch {
    return "missing"
  }
  if (response.status === 404) return "not_found"
  if (!response.ok) return "missing"
  const declared = Number(response.headers.get("content-length") ?? "0")
  if (declared > maxBytes) return "too_large"
  const bytes = new Uint8Array(await response.arrayBuffer())
  return bytes.length > maxBytes ? "too_large" : bytes
}

/**
 * Checks that the pinned device service release is served with a valid signature before an omo release
 * publishes. Only the two signed index files are fetched: checksums.txt and checksums.txt.sig. The
 * release is blocked when the pin names a version the origin does not serve (both files 404), when
 * either file cannot be fetched, or when the signature does not verify against the release key set.
 * This mirrors the download and verification rules of acquireDeviceService for those two files, minus
 * the binary download and install.
 */
export const verifyDeviceServicePin = async (options: VerifyPinOptions): Promise<VerifyPinResult> => {
  const { version } = options
  const base = `${options.origin ?? DEVICE_SERVICE_ORIGIN}/${options.channel ?? "stable"}/device-service/${version}/`
  const keys = releaseKeySetBytes(options.releaseKeys ?? DEVICE_SERVICE_RELEASE_KEYS)
  if (keys === undefined)
    return {
      ok: false,
      refusal: "release_key_invalid",
      message:
        `OmO device service ${version} cannot be verified: this omo build carries no usable device service ` +
        `release key, so the pinned release cannot be checked before publish.`,
    }
  const get = (name: string, maxBytes: number) =>
    download(options.fetch ?? globalThis.fetch, base, name, maxBytes)
  const [checksums, signature] = await Promise.all([
    get(CHECKSUMS, CHECKSUMS_MAX_BYTES),
    get(SIGNATURE, SIGNATURE_BYTES),
  ])
  // The origin answering 404 for both signed entry files means this pin was never published, which is
  // not a connection problem. A 404 on only one of them is a broken release and stays download_failed.
  if (checksums === "not_found" && signature === "not_found")
    return {
      ok: false,
      refusal: "not_published",
      message:
        `OmO device service ${version} is not published: ${base}${CHECKSUMS} answers 404, so an omo ` +
        `release pinning ${version} must not publish. Publish the device service release first, then re-run.`,
    }
  if (typeof checksums === "string")
    return {
      ok: false,
      refusal: "download_failed",
      message:
        `OmO device service ${version} could not be checked: ${base}${CHECKSUMS} failed to download ` +
        `(${checksums}). Refusing to publish an omo release whose pinned device service cannot be verified.`,
    }
  if (typeof signature === "string")
    return {
      ok: false,
      refusal: "download_failed",
      message:
        `OmO device service ${version} could not be checked: ${base}${SIGNATURE} failed to download ` +
        `(${signature}). Refusing to publish an omo release whose pinned device service cannot be verified.`,
    }
  const verdict = await verifyReleaseSignature(keys, signature, checksums)
  if (!verdict.ok)
    return {
      ok: false,
      refusal: verdict.refusal,
      message:
        `OmO device service ${version} failed verification: the signature over ${base}${CHECKSUMS} does ` +
        `not verify against the device service release key set (${verdict.refusal}). Refusing to publish ` +
        `an omo release pinned to an unverifiable device service.`,
    }
  return { ok: true, version }
}
