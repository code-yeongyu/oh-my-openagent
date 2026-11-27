import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// The install core's part the omo SDK root loads through `omo-ai/sdk` (first-party design 3.1, 4.1). Each call takes its
// ports as one argument with real defaults; slice C1c adds setup, update and version here.

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const SDK_EXPORT = "./sdk"

const builtFile = (entry) => (typeof entry === "string" ? entry : (entry?.import ?? entry?.default))

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
 * The install namespace's calls, keyed as the root names them after `install.`.
 * @returns {{ readonly sdkRoot: (input?: object) => ReturnType<typeof sdkRoot> }}
 */
export function installCore() {
  return { sdkRoot: (input) => sdkRoot(input) }
}
