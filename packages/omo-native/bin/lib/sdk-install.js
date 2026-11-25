// @ts-check
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// The install core's part the omo SDK root loads through `omo-ai/sdk` (first-party design 3.1, 4.1). Each call takes its
// ports as one argument with real defaults; the calls of slice C1c live in install-calls.js, loaded on the first call.

/** The directory the built `omo-ai/sdk` entry lives in for this install: what `omo sdk root` prints. */
const SDK_ENTRY_DIR = join(dirname(fileURLToPath(import.meta.url)), "sdk")

/** @param {object} [_input] @returns {Promise<{ readonly kind: "ok"; readonly value: { readonly path: string } }>} */
async function sdkRoot(_input = {}, ports = { entryDir: SDK_ENTRY_DIR }) {
  return { kind: "ok", value: { path: ports.entryDir } }
}

/**
 * The install namespace's calls, keyed as the root names them after `install.`. The root's call options are not ports:
 * a member passes only the input, so each call runs on its own real ports.
 * @returns {Promise<import("../../../omo-senpi/src/components/omo-sdk/root/members.ts").NamespaceCore<"install">>}
 */
export async function installCore() {
  const calls = await import("./install-calls.js")
  return {
    sdkRoot: (input) => sdkRoot(input),
    version: async (input) => calls.version(input),
    update: (input) => calls.update(input),
    "setup.detect": (input) => calls.setup.detect(input),
    "setup.plan": (input) => calls.setup.plan(input),
    "setup.apply": (input) => calls.setup.apply(input),
  }
}
