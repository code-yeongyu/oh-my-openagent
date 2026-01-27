/**
 * Boulder State Constants
 */

export const BOULDER_DIR = ".sisyphus"
export const BOULDER_FILE = "boulder.json"
export const BOULDER_STATE_PATH = `${BOULDER_DIR}/${BOULDER_FILE}`

export const NOTEPAD_DIR = "notepads"
export const NOTEPAD_BASE_PATH = `${BOULDER_DIR}/${NOTEPAD_DIR}`

/** Primary changes directory - all plans go here */
export const CHANGES_DIR = "changes"

/** @deprecated Use CHANGES_DIR instead. Kept for backward compatibility during migration. */
export const LEGACY_CHANGES_DIR = "changes"

/** @deprecated .sisyphus/plans/ is no longer used. Plans should be in changes/. */
export const PROMETHEUS_PLANS_DIR = ".sisyphus/plans"
