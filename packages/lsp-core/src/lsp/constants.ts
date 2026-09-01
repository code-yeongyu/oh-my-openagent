export const DEFAULT_MAX_REFERENCES = 200;
export const DEFAULT_MAX_SYMBOLS = 200;
export const DEFAULT_MAX_DIAGNOSTICS = 200;
export const DEFAULT_MAX_DIRECTORY_FILES = 50;

export const REQUEST_TIMEOUT_MS = 15_000;
export const INIT_TIMEOUT_MS = 60_000;
export const IDLE_TIMEOUT_MS = 5 * 60_000;
export const MAX_RESIDENT_CLIENTS = 6;
export const REAPER_INTERVAL_MS = 60_000;
export const STOP_HARD_KILL_TIMEOUT_MS = 5_000;
export const STOP_SIGKILL_GRACE_MS = 1_000;

/** Max consecutive dead client generations respawned for one key before admission is blocked. */
export const CLIENT_RESPAWN_RETRY_LIMIT = 2;
/** How long a spent respawn budget blocks admission before a fresh attempt window opens. */
export const CLIENT_RESPAWN_COOLDOWN_MS = 60_000;
