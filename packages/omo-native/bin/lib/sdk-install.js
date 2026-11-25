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
 * The install namespace's calls, keyed as the root names them after `install.`. They run on the root's own environment
 * and home; the root's call options are not ports.
 * @param {import("../../../omo-senpi/src/components/omo-sdk/root/members.ts").CoreContext} context
 * @returns {Promise<import("../../../omo-senpi/src/components/omo-sdk/root/members.ts").NamespaceCore<"install">>}
 */
export async function installCore(context) {
  const ports = { env: { ...context.env }, ...(context.home === undefined ? {} : { home: context.home }) }
  const calls = await import("./install-calls.js")
  // This root's own setup calls: a plan its plan call answered is applied only through its apply.
  const setup = calls.createSetup()
  return {
    sdkRoot: (input) => sdkRoot(input),
    version: async (input) => calls.version(input),
    update: (input) => calls.update(input, ports),
    "setup.detect": (input) => setup.detect(input, ports),
    "setup.plan": (input) => setup.plan(input, ports),
    "setup.apply": (input) => setup.apply(input, ports),
  }
}
