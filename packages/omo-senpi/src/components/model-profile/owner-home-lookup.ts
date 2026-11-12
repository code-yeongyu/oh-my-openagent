import { execFileSync } from "node:child_process"

import { log } from "@oh-my-opencode/utils"

import { findOnPath } from "../claude-code/find-on-path"

/** How long a lookup answer (a home, a missing account or a failure) is reused before the user database is asked again. */
export const OWNER_LOOKUP_TTL_MS = 30_000

/** The home field of one passwd entry: `getent passwd <uid>` (7 fields) or macOS `id -P <uid>` (10 fields). */
export function homeFromPasswdEntry(entry: string): string | null {
  const fields = entry.split("\n")[0]?.split(":") ?? []
  if (fields.length < 7) return null
  const home = fields[fields.length - 2]
  return home !== undefined && home.startsWith("/") ? home : null
}

export interface PasswdLookupDeps {
  readonly platform?: NodeJS.Platform
  readonly which?: (command: string) => string | null
  readonly exec?: (file: string, args: readonly string[]) => string
}

function execLookup(file: string, args: readonly string[]): string {
  return execFileSync(file, [...args], {
    encoding: "utf8",
    timeout: 2_000,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
}

// getent exits 2 when the key is not found; macOS id exits 1 with "no such user". Anything else is a failed lookup.
function isNoSuchAccount(error: unknown, platform: NodeJS.Platform): boolean {
  if (typeof error !== "object" || error === null) return false
  const status = Reflect.get(error, "status")
  if (platform !== "darwin") return status === 2
  const stderr = Reflect.get(error, "stderr")
  return status === 1 && /no such user/i.test(typeof stderr === "string" ? stderr : String(stderr ?? ""))
}

/**
 * The passwd entry of the account with this uid through the lookup binary on PATH (`getent`, or `id -P` on macOS), so
 * hosts that keep it outside /usr/bin (NixOS) still answer. Null when there is no such account; throws when the
 * binary is missing or the lookup fails.
 */
export function runPasswdLookup(uid: number, deps: PasswdLookupDeps = {}): string | null {
  const platform = deps.platform ?? process.platform
  const [command, args] = platform === "darwin" ? ["id", ["-P", String(uid)]] : ["getent", ["passwd", String(uid)]]
  const file = (deps.which ?? ((name: string) => findOnPath(name)))(command)
  if (file === null) throw new Error(`${command} is not on PATH`)
  try {
    return (deps.exec ?? execLookup)(file, args)
  } catch (error) {
    if (isNoSuchAccount(error, platform)) return null
    throw error
  }
}

const homeByUid = new Map<number, { readonly home: string | null | undefined; readonly at: number }>()

/**
 * The home of the account with this uid: null when there is no such account, undefined when the lookup failed. Every
 * answer is reused for `OWNER_LOOKUP_TTL_MS`, so a down user database costs at most one call per uid per window, and a
 * recovered database, a moved home or a reused uid is seen again after it.
 */
export function lookupHomeOfUid(
  uid: number,
  run: (uid: number) => string | null = runPasswdLookup,
  now: () => number = Date.now,
): string | null | undefined {
  const cached = homeByUid.get(uid)
  if (cached !== undefined && now() - cached.at < OWNER_LOOKUP_TTL_MS) return cached.home
  let home: string | null | undefined
  try {
    const entry = run(uid)
    home = entry === null ? null : homeFromPasswdEntry(entry)
  } catch (error) {
    log("[model-profile] passwd home lookup failed; the home refusal falls back to its fail-closed rules", {
      uid,
      error: error instanceof Error ? error.message : String(error),
    })
    home = undefined
  }
  homeByUid.set(uid, { home, at: now() })
  return home
}
