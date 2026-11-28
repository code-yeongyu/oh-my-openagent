import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** Diagnostic variant (never merged): a real, empty temp dir instead of a POSIX-only nonexistent path. */
export const FAKE_HOST_KEY_ROOT = mkdtempSync(join(tmpdir(), "omo-fake-host-key-root-"))
