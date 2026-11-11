// The one seam through which a machine retires a memory-sync trust pin (#12280): called exactly when,
// and immediately before, the private keys of the principal that earned the pin are discarded (a
// sign-in ended, `omo logout`, `omo account forget`, a re-login or adopt that replaces the device, the
// desktop discarding its sealed session). Retiring renames the pin directory aside, idempotent on a
// missing pin; only a ceremony pins again. It owns the pin's directory layout with trust-pin.ts, and
// imports nothing from the crypto layer, so the service-auth callers can reach it.

import { createHash, randomBytes } from "node:crypto"
import { join } from "node:path"

import { readdir, rename } from "../fs/resilient"

export { resolveMemoryRoot } from "../identity/layout"
export { syncPinDir } from "./pin-dir"

export const trustAnchorRoot = (pinDir: string): string => join(pinDir, "trust-anchor")
export const trustAnchorKey = (account: string): string =>
  createHash("sha256").update(account, "utf8").digest("base64url")
export const trustAnchorDir = (pinDir: string, account: string): string =>
  join(trustAnchorRoot(pinDir), trustAnchorKey(account))

/** Whether any account has a live (not retired) pin under `pinDir`. */
export const hasLiveTrustAnchor = async (pinDir: string): Promise<boolean> => {
  try {
    return (await readdir(trustAnchorRoot(pinDir))).some((name) => !name.includes(".retired-"))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}

export const retireSyncDevice = async (input: { readonly pinDir: string; readonly account: string }): Promise<void> => {
  const dir = trustAnchorDir(input.pinDir, input.account)
  try {
    await rename(dir, `${dir}.retired-${Date.now()}-${randomBytes(4).toString("hex")}`)
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
}
