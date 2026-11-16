import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import { parseChecksums } from "./checksums.ts"
import { releaseAssetName } from "./release-assets.ts"
import type { EngineLaunchRefusalReason } from "./refusal.ts"

/**
 * The macOS designated requirement of a release engine: the launcher bundle's identifier (the one
 * macOS identity) signed by the release team's Developer ID. A local or ad-hoc build fails it.
 */
const ENGINE_DESIGNATED_REQUIREMENT =
  'identifier "ai.sisyphuslabs.omo-computer-helper" and anchor apple generic ' +
  'and certificate leaf[subject.OU] = "523JNR86LZ" ' +
  "and certificate 1[field.1.2.840.113635.100.6.2.6] exists " +
  "and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"

/** Runs `codesign` with these arguments: its exit status, or `null` when it could not run. */
export type CodesignRunner = (args: readonly string[]) => number | null

export const runSystemCodesign: CodesignRunner = (args) => {
  const result = spawnSync("/usr/bin/codesign", [...args], { stdio: "ignore", timeout: 5000 })
  return result.error === undefined ? result.status : null
}

export type DesignatedRequirementVerdict = "satisfied" | "mismatch" | "not_applicable"

/** macOS only; a codesign that cannot run reads as a mismatch (fail closed). */
export function verifyDesignatedRequirement(
  path: string,
  options: { readonly platform: string; readonly runCodesign: CodesignRunner },
): DesignatedRequirementVerdict {
  if (options.platform !== "darwin") return "not_applicable"
  const status = options.runCodesign(["--verify", "--strict", `-R=${ENGINE_DESIGNATED_REQUIREMENT}`, path])
  return status === 0 ? "satisfied" : "mismatch"
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

/**
 * The digests pinned in the package (src/release-digests.ts): the trust anchor. The checksums file
 * beside a prebuild lives in the same root as the binary, so it proves integrity, never provenance.
 */
export type PinnedDigests = Readonly<Record<string, string>>

export type ChecksumVerdict =
  | { readonly kind: "trusted"; readonly sha256: string }
  | { readonly kind: "refused"; readonly reason: EngineLaunchRefusalReason; readonly detail: string }

/**
 * The engine at `path` is trusted only when its sha256 equals the digest the package pins for the
 * host's asset AND the host's entry in the checksums file beside it (which must agree with the pin).
 */
export function verifyChecksum(
  path: string,
  host: string,
  checksumsPath: string,
  pinned: PinnedDigests,
): ChecksumVerdict {
  const asset = releaseAssetName(host)
  if (asset === null)
    return { kind: "refused", reason: "no_release_asset", detail: `no engine is published for ${host}` }
  const anchor = pinned[asset]
  if (anchor === undefined)
    return { kind: "refused", reason: "no_pinned_digest", detail: `this package pins no digest for ${asset}` }
  let text: string
  try {
    text = readFileSync(checksumsPath, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      return {
        kind: "refused",
        reason: "checksums_unreadable",
        detail: `${checksumsPath}: ${String(Reflect.get(error, "code"))}`,
      }
    }
    throw error
  }
  const parsed = parseChecksums(text)
  if (parsed.kind === "invalid") return { kind: "refused", reason: "checksums_unreadable", detail: parsed.detail }
  const expected = parsed.digests.get(asset)
  if (expected === undefined)
    return { kind: "refused", reason: "no_checksum_entry", detail: `${checksumsPath} has no line for ${asset}` }
  if (expected !== anchor) {
    return {
      kind: "refused",
      reason: "checksum_mismatch",
      detail: `${checksumsPath} says ${asset} is ${expected}, the package pins ${anchor}`,
    }
  }
  const actual = sha256File(path)
  return actual === anchor
    ? { kind: "trusted", sha256: actual }
    : { kind: "refused", reason: "checksum_mismatch", detail: `${path} is ${actual}, ${asset} is pinned ${anchor}` }
}
