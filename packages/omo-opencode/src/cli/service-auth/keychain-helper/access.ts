import { callHelper, type HelperCall, type HelperLease, HelperProtocolError, type HelperReply, type HelperSpawner, spawnDetachedHelper } from "./client"
import { locateHelper } from "./location"
import { type PinResult, pinVerifiedCopy } from "./pin"
import { processSignatureChecker, type SignatureVerdict } from "./signature"

export type HelperAccess =
  | { readonly kind: "ready"; readonly path: string; readonly call: (call: HelperCall, lease?: HelperLease) => Promise<HelperReply> }
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly rejected: readonly string[] }
  | { readonly kind: "unavailable"; readonly reason: string }

/**
 * The only way the store reaches a helper process. The located copy is pinned (copied into this process's private
 * directory and verified there), and the pinned copy is checked again before EVERY spawn through the process's one
 * checker. So an unsigned, ad-hoc-signed or tampered file is never executed: not at resolution, not after a later
 * swap at the original path (never spawned), and not after a change to the pinned copy (refused).
 */
export async function resolveHelperAccess(
  candidates: readonly string[],
  options: {
    readonly verify?: (path: string) => Promise<SignatureVerdict>
    readonly spawn?: HelperSpawner
    readonly pin?: (source: string, verify: (path: string) => Promise<SignatureVerdict>) => Promise<PinResult>
  } = {},
): Promise<HelperAccess> {
  const verify = options.verify ?? processSignatureChecker()
  const location = await locateHelper(candidates, verify)
  if (location.kind !== "found") return location
  const pin = await (options.pin ?? pinVerifiedCopy)(location.path, verify)
  if (pin.kind === "invalid") return { kind: "invalid", rejected: [location.path] }
  if (pin.kind === "unavailable") return { kind: "unavailable", reason: pin.reason }
  const pinned = pin.path
  const spawn = options.spawn ?? spawnDetachedHelper
  return {
    kind: "ready",
    path: pinned,
    call: async (call, lease) => {
      if ((await verify(pinned)) !== "valid")
        throw new HelperProtocolError("OmO's keychain helper changed on disk and failed its signature check; it was not run.")
      return callHelper(pinned, call, { spawn, ...(lease === undefined ? {} : { lease }) })
    },
  }
}
