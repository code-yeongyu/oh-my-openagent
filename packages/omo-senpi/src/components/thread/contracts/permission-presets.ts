// senpi's approval modes (permission-system/types.ts `PermissionPresetName`).
export const PERMISSION_PRESETS = ["full-access", "workspace", "accept-edits", "auto", "read-only", "ask"] as const
export type PermissionPreset = (typeof PERMISSION_PRESETS)[number]

export const isPermissionPreset = (value: string): value is PermissionPreset =>
  PERMISSION_PRESETS.some((preset) => preset === value)

/**
 * The modes each mode lets through without asking, by senpi's preset rules (permission-system/config.ts): full-access
 * allows everything; workspace allows read, edit and bash; accept-edits drops bash; read-only drops edit; ask allows
 * nothing. auto asks for everything and approves only its own allowlist, so it is below full-access and above ask only:
 * its allowlist includes calls read-only would ask for, and read-only allows reads auto may ask for.
 */
const AT_MOST: Readonly<Record<PermissionPreset, readonly PermissionPreset[]>> = {
  "full-access": PERMISSION_PRESETS,
  workspace: ["workspace", "accept-edits", "read-only", "ask"],
  "accept-edits": ["accept-edits", "read-only", "ask"],
  "read-only": ["read-only", "ask"],
  auto: ["auto", "ask"],
  ask: ["ask"],
}

/**
 * Whether a session in `creator`'s mode may start a thread in `requested`: the same mode or one that lets less through.
 * A creator whose mode is unknown may only ask for `ask`, the one mode below every other.
 */
export function presetWithin(requested: PermissionPreset, creator: string | undefined): boolean {
  if (creator === undefined || !isPermissionPreset(creator)) return requested === "ask"
  return AT_MOST[creator].includes(requested)
}
