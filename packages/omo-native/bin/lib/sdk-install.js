// @ts-check
import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// The install core's part the omo SDK root loads through `omo-ai/sdk` (first-party design 3.1, 4.1). Each call takes its
// ports as one argument with real defaults; the calls of slice C1c live in install-calls.js and install-setup-calls.js, loaded on the first call.

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const SDK_EXPORT = "./sdk"

/** @param {unknown} entry @returns {unknown} */
const builtFile = (entry) =>
  typeof entry === "string" ? entry : (Reflect.get(Object(entry), "import") ?? Reflect.get(Object(entry), "default"))

/**
 * The directory of the built `omo-ai/sdk` entry of this install, what `omo sdk root` prints: read from the package's
 * own manifest, so it is wherever the export points. A manifest without the export answers not_implemented.
 * @param {object} [_input]
 * @param {{ packageDir: string, fs: { readFile: (path: string) => Promise<string> } }} [ports]
 * @returns {Promise<{ kind: "ok", value: { path: string } } | { kind: "error", error: { code: "not_implemented", message: string, next_action: string, details: { entry: string } } }>}
 */
export async function sdkRoot(
  _input = {},
  ports = { packageDir: PACKAGE_DIR, fs: { readFile: (path) => readFile(path, "utf8") } },
) {
  const manifest = JSON.parse(await ports.fs.readFile(join(ports.packageDir, "package.json")))
  const file = builtFile(manifest.exports?.[SDK_EXPORT])
  if (typeof file !== "string")
    return {
      kind: "error",
      error: {
        code: "not_implemented",
        message: "This install of omo-ai has no omo-ai/sdk entry.",
        next_action: "Update omo-ai to a release that ships the SDK entry.",
        details: { entry: "omo-ai/sdk" },
      },
    }
  return { kind: "ok", value: { path: dirname(join(ports.packageDir, file)) } }
}

/**
 * The install namespace's calls, keyed as the root names them after `install.`. They run on the root's own environment
 * and home; the root's call options are not ports. `overrides` replaces ports per call (the SDK's scenario drivers pass
 * their fakes); the `omo-ai/sdk` entry passes none.
 * @param {import("../../../omo-senpi/src/components/omo-sdk/root/members.ts").CoreContext} context
 * @param {{ update?: Record<string, unknown>, setup?: Record<string, unknown>, version?: Record<string, unknown> }} [overrides]
 * @returns {Promise<import("../../../omo-senpi/src/components/omo-sdk/root/members.ts").NamespaceCore<"install">>}
 */
export async function installCore(context, overrides = {}) {
  const base = { env: { ...context.env }, ...(context.home === undefined ? {} : { home: context.home }) }
  const updatePorts = { ...base, ...overrides.update }
  const ports = { ...base, ...overrides.setup }
  const calls = await import("./install-calls.js")
  const { createSetup } = await import("./install-setup-calls.js")
  // This root's own setup calls: a plan its plan call answered is applied only through its apply.
  const setup = createSetup()
  return {
    sdkRoot: (input) => sdkRoot(input),
    version: async (input) => calls.version(input, overrides.version),
    update: (input, options) => calls.update(input, updatePorts, options),
    "setup.detect": (input, options) => setup.detect(input, ports, options),
    "setup.plan": (input, options) => setup.plan(input, ports, options),
    "setup.apply": (input, options) => setup.apply(input, ports, options),
  }
}
