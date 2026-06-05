import { join } from "path"
import { getOpenCodeStorageDir } from "../shared/data-path"

export const OPENCLAW_STORAGE_DIR = join(getOpenCodeStorageDir(), "openclaw")
export const REGISTRY_PATH = join(OPENCLAW_STORAGE_DIR, "reply-session-registry.jsonl")
export const REGISTRY_LOCK_PATH = join(OPENCLAW_STORAGE_DIR, "reply-session-registry.lock")
export const SECURE_FILE_MODE = 0o600
export const MAX_AGE_MS = 24 * 60 * 60 * 1000
export const LOCK_TIMEOUT_MS = 2000
export const LOCK_WAIT_TIMEOUT_MS = 4000
export const LOCK_RETRY_MS = 20
export const LOCK_STALE_MS = 10000
