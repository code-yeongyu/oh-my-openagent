import { lstatSync } from "node:fs"
import { userInfo } from "node:os"
import { join } from "node:path"
import type { HelperReply } from "./client"

/**
 * OmO's own keychain for a Mac whose login keychain stays locked (#13116, opt-in, design r2). The helper owns the files;
 * this side only reads whether the store is active, from the same password-database home the helper uses.
 */
const DEDICATED_STORE_DIRECTORY = join("Library", "Application Support", "OmO", "credential-keychain")

export type DedicatedStoreState = "absent" | "inactive" | "active"

const accountHomeDirectory = (): string => userInfo().homedir

export const dedicatedStoreRoot = (home: string = accountHomeDirectory()): string =>
  join(home, DEDICATED_STORE_DIRECTORY)

const exists = (path: string): boolean => {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

export function dedicatedStoreState(home: string = accountHomeDirectory()): DedicatedStoreState {
  const root = dedicatedStoreRoot(home)
  if (!exists(root)) return "absent"
  return exists(join(root, "active")) ? "active" : "inactive"
}

const REFUSAL_MESSAGES: Readonly<Record<string, string>> = {
  "store-required":
    "OmO's own keychain was turned on while this command was running. Run the command again; if this keeps happening, update omo and the OmO desktop app.",
  "store-inactive": "OmO's own keychain was turned off while omo was using it. Run the command again.",
  home: "OmO's own keychain is used only when HOME is the home directory the user database lists for your account. Run omo without changing HOME, or check that your account has a home directory.",
  active: "OmO's own keychain is still active. Run omo account store disable first.",
  "not-empty":
    "OmO's own keychain still holds a sign-in. Run omo account store disable to move it back, or omo logout first.",
}

/**
 * A refusal from the dedicated store, or an older helper refusing the store field (it predates #13116), as the one
 * sentence the user acts on; null for any other reply.
 */
export function dedicatedStoreRefusal(reply: HelperReply): string | null {
  if (reply.error === "refused" && reply.reason === "unknown-key")
    return "OmO's keychain helper on this Mac is older than this omo and cannot use OmO's own keychain. Update omo, then try again."
  if (reply.error !== "store-refused") return null
  const known = reply.reason === undefined ? undefined : REFUSAL_MESSAGES[reply.reason]
  return (
    known ??
    `OmO's own keychain at ${dedicatedStoreRoot()} was refused (${reply.reason ?? "unknown"}). Check that the folder and its files belong to you and are private (0700 folder, 0600 files); omo never repairs them or falls back to the login keychain.`
  )
}
