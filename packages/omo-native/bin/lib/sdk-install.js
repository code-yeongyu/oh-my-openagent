import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// The install core's part the omo SDK root loads through `omo-ai/sdk` (first-party design 3.1, 4.1). Each call takes its
// ports as one argument with real defaults; slice C1c adds setup, update and version here.

/** The directory the built `omo-ai/sdk` entry lives in for this install: what `omo sdk root` prints. */
const SDK_ENTRY_DIR = join(dirname(fileURLToPath(import.meta.url)), "sdk")

async function sdkRoot(_input = {}, ports = { entryDir: SDK_ENTRY_DIR }) {
  return { kind: "ok", value: { path: ports.entryDir } }
}

/**
 * The install namespace's calls, keyed as the root names them after `install.`.
 * @returns {{ readonly sdkRoot: (input?: object) => Promise<{ readonly kind: "ok"; readonly value: { readonly path: string } }> }}
 */
export function installCore() {
  return { sdkRoot: (input) => sdkRoot(input) }
}
