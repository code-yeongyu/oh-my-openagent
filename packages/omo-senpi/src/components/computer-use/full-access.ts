/**
 * The slice of the extension API that tells the permission preset senpi enforces for this session.
 *
 * `getPermissionPreset` is the permission system's own decision (senpi #3301): settings, then the
 * session flag, then the full-access default, with the same untrusted-project handling as enforcement
 * and the host's live preset switches applied. Computer use consumes it instead of re-deriving the
 * preset from the raw `permission-preset` flag (#2465: Full access means no prompts, decided once).
 */
export interface PermissionPresetSource {
  getPermissionPreset?(): string | undefined
}

const FULL_ACCESS = "full-access"

/**
 * True only when senpi's permission system enforces Full access for this session (#10022). A host
 * without the permission system, or a session it has not bound yet, never counts as full access, so
 * the foreground-control confirm stays.
 */
export function isFullAccess(source: PermissionPresetSource): boolean {
  return source.getPermissionPreset?.() === FULL_ACCESS
}

/** The full-access check for a session, read fresh on every foreground-control acquire. */
export function watchFullAccess(pi: PermissionPresetSource): () => boolean {
  return () => isFullAccess(pi)
}
