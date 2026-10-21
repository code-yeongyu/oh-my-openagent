import * as z from "zod"

import type { OmoHarnessId } from "./harness"

/**
 * At-rest encryption mode for `<agentDir>/auth.json` on the native harness.
 *
 * - `plain`     - JSON plaintext, mode 0600. The historical default, deprecated
 *   on this PR (security roadmap 2026q4) and scheduled to flip default in six months.
 * - `passphrase` - AES-256-GCM with a scrypt(passphrase) derived key. Passphrase
 *   comes from `OMO_AUTH_PASSPHRASE` or a first-run prompt and lives in process memory only.
 * - `ssh-key`   - AES-256-GCM with an HKDF key derived from a user-owned ssh key
 *   (`~/.ssh/id_ed25519` by default). No second secret required.
 *
 * PR-E: opt-in only. `plain` stays the default to limit blast radius. A later "sunset"
 * PR will switch the default.
 */
const OmoAuthAtRestModeSchema = z.enum(["plain", "passphrase", "ssh-key"])

export const OmoSecurityAuthAtRestLayerSchema = z.object({
  /** Auth-at-rest encryption mode for the native harness. */
  auth_at_rest: OmoAuthAtRestModeSchema.optional(),
  /** Override the ssh-key path used by `ssh-key` mode. Defaults to `~/.ssh/id_ed25519`. */
  ssh_key_path: z.string().optional(),
}).strict()

export const OmoSecurityAuthAtRestSchema = OmoSecurityAuthAtRestLayerSchema.extend({
  auth_at_rest: OmoAuthAtRestModeSchema.default("plain"),
}).strict()

export type OmoSecurityAuthAtRest = z.infer<typeof OmoSecurityAuthAtRestSchema>
export type OmoSecurityAuthAtRestLayer = z.infer<typeof OmoSecurityAuthAtRestLayerSchema>

export interface OmoSecurityAuthAtRestConfigView {
  readonly security?: { auth_at_rest?: OmoSecurityAuthAtRest["auth_at_rest"]; ssh_key_path?: string }
}

const SECURITY_HARNESS_SUPPORT: Record<string, readonly OmoHarnessId[]> = {
  "security.auth_at_rest": ["native"],
  "security.ssh_key_path": ["native"],
} as const

/** Resolve auth-at-rest settings, applying defaults when the section is absent. */
export function resolveOmoSecurityAuthAtRest(
  config: OmoSecurityAuthAtRestConfigView,
): OmoSecurityAuthAtRest {
  return config.security
    ? OmoSecurityAuthAtRestSchema.parse(config.security)
    : OmoSecurityAuthAtRestSchema.parse({})
}
