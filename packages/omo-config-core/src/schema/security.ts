import * as z from "zod"

/**
 * Directories a `{file:...}` placeholder may read from, as the config spells them: an absolute
 * path, or one beginning `~/` (expanded against the user's home, never a per-run cwd). The default
 * is the single OpenCode config dir, where setup already reads user config from.
 *
 * Setting this replaces the default rather than adding to it, so a user who names a root gets
 * exactly that root. The built-in denylist (`/proc`, `/sys`, `/dev`, `/etc/shadow`, `~/.ssh`,
 * `~/.gnupg`, `~/.aws`) is not configurable and applies whatever this holds.
 */
export const DEFAULT_FILE_REF_ALLOWLIST_ROOTS = ["~/.config/opencode"]

export const OmoFileRefAllowlistRootsSchema = z
  .array(z.string().refine((root) => root.startsWith("/") || root === "~" || root.startsWith("~/"), {
    message: "a file_ref_allowlist_roots entry must be an absolute path or start with ~/",
  }))
  .describe(`Absolute paths, or paths starting "~/", a {file:...} placeholder may read from. Default ${JSON.stringify(DEFAULT_FILE_REF_ALLOWLIST_ROOTS)}. Replaces the default rather than extending it. /proc, /sys, /dev, /etc/shadow, ~/.ssh, ~/.gnupg and ~/.aws are never readable, whatever this holds.`)

/**
 * Whether a `{file:...}` reference outside the allowlist is refused or resolved. `"refuse"` is the
 * shipped default and the only mode this release honours, so the config carries the decision as a
 * readable key rather than an implicit one.
 */
export const OmoFileRefDefaultModeSchema = z
  .enum(["refuse", "allow"])
  .default("refuse")
  .describe('"refuse" (default): a {file:...} reference outside file_ref_allowlist_roots is refused and named in the setup summary. Widen file_ref_allowlist_roots instead.')

const OmoSecurityShape = {
  file_ref_allowlist_roots: OmoFileRefAllowlistRootsSchema,
  file_ref_default_mode: OmoFileRefDefaultModeSchema,
}

export const OmoSecuritySettingsLayerSchema = z.object(OmoSecurityShape).partial().strict()

export const OmoSecuritySettingsSchema = z.object({
  file_ref_allowlist_roots: OmoFileRefAllowlistRootsSchema.default(DEFAULT_FILE_REF_ALLOWLIST_ROOTS),
  file_ref_default_mode: OmoFileRefDefaultModeSchema,
}).strict()

export type OmoSecuritySettings = z.infer<typeof OmoSecuritySettingsSchema>
export type OmoSecuritySettingsLayer = z.infer<typeof OmoSecuritySettingsLayerSchema>

export interface OmoSecurityConfigView {
  readonly security?: OmoSecuritySettings
}

/** The roots a `{file:...}` reference may resolve from, with the shipped default applied. */
export function fileRefAllowlistRoots(config: OmoSecurityConfigView): string[] {
  return config.security?.file_ref_allowlist_roots ?? DEFAULT_FILE_REF_ALLOWLIST_ROOTS
}