/** Bounds spawn + `engine.hello` + `session.open` of a fresh engine child. */
export const START_TIMEOUT_MS = 10_000;

/**
 * Bounds `session.close` plus the child's exit at stdin EOF before it is killed. At least
 * HOLD_RELEASE_GRACE_MS, so a close never kills the engine inside its 2 s hold-release wait.
 */
export const CLOSE_TIMEOUT_MS = 3_000;

/** How long a timed-out or aborted request may take to answer `$/cancel` before the child is killed. */
export const GRACE_MS = 750;

/** Grace for a cancelled hold: longer than the engine's 2 s wait for the held input's release, so the child is never killed mid-release. */
export const HOLD_RELEASE_GRACE_MS = 2_500;

/** Bounds a `capabilities` request. */
export const CAPABILITIES_TIMEOUT_MS = 10_000;

/** Cadence of `stopPath.heartbeat` while a session is open. */
export const HEARTBEAT_MS = 500;

/** Bounds a best-effort `control.revoke`; failure is logged, `session.close` stays the backstop. */
export const REVOKE_TIMEOUT_MS = 2_000;

/** Why a request failed after the child was killed for ignoring `$/cancel`. */
export const RESTART_MESSAGE = "desktop engine restarted; captures and ax refs were reset";

/** Why `open` failed when the engine never finished starting. */
export const START_TIMEOUT_MESSAGE = "Timed out starting desktop engine";
