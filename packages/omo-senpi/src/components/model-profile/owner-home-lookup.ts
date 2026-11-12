import { execFileSync } from "node:child_process"

import { log } from "@oh-my-opencode/utils"

/** How long a failed lookup or a missing account is reused before the user database is asked again. */
export const OWNER_LOOKUP_FAILURE_TTL_MS = 30_000

/** The home field of one passwd entry: `getent passwd <uid>` (7 fields) or macOS `id -P <uid>` (10 fields). */
export function homeFromPasswdEntry(entry: string): string | null {
  const fields = entry.split("\n")[0]?.split(":") ?? []
  if (fields.length < 7) return null
  const home = fields[fields.length - 2]
  return home !== undefined && home.startsWith("/") ? home : null
}

function runPasswdLookup(uid: number): string {
  const [command, args] =
    process.platform === "darwin"
      ? (["/usr/bin/id", ["-P", String(uid)]] as const)
      : (["/usr/bin/getent", ["passwd", String(uid)]] as const)
  return execFileSync(command, [...args], {
    encoding: "utf8",
    timeout: 2_000,
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  })
}

const homeByUid = new Map<number, { readonly home: string | null | undefined; readonly at: number }>()

/**
 * The home of the account with this uid: null when there is no such account, undefined when the lookup failed. A found
 * home is reused for the process; a failure or a missing account is reused for `OWNER_LOOKUP_FAILURE_TTL_MS`, so a
 * down user database costs at most one call per owner per window and a recovered one is used again after it.
 */
export function lookupHomeOfUid(
  uid: number,
  run: (uid: number) => string = runPasswdLookup,
  now: () => number = Date.now,
): string | null | undefined {
  const cached = homeByUid.get(uid)
  if (cached !== undefined && (typeof cached.home === "string" || now() - cached.at < OWNER_LOOKUP_FAILURE_TTL_MS))
    return cached.home
  let home: string | null | undefined
  try {
    home = homeFromPasswdEntry(run(uid))
  } catch (error) {
    log("[model-profile] owner home lookup failed; a folder another account owns is refused instead", {
      uid,
      error: error instanceof Error ? error.message : String(error),
    })
    home = undefined
  }
  homeByUid.set(uid, { home, at: now() })
  return home
}
