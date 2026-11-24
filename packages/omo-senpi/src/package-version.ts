import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// The plugin manifest (`plugin/package.json`, the Pi package) sits above every bundle: `extensions/*.js`,
// `runtime/<sdk>/sdk.js` and `runtime/rollback-migrate.js`, in a checkout, the omo-ai npm package and the compiled
// binary's provisioned runtime alike. A source run finds the adapter manifest above `src/`. Both carry the release version.
const MANIFEST_NAMES = new Set(["@code-yeongyu/omo-senpi", "@oh-my-opencode/omo-senpi"])

function versionOf(path: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== "object") return undefined
  const name: unknown = Reflect.get(parsed, "name")
  const version: unknown = Reflect.get(parsed, "version")
  return typeof name === "string" && MANIFEST_NAMES.has(name) && typeof version === "string" ? version : undefined
}

/**
 * The omo-senpi version, read when asked from the nearest omo-senpi manifest above `moduleUrl` (this module, or the
 * bundle it is inlined into). Never compiled in, so a release stamp changes no committed bundle (#14867). A layout
 * with no manifest is a broken install and throws instead of reporting a made-up version.
 */
export function omoSenpiPackageVersion(moduleUrl: string = import.meta.url): string {
  const start = dirname(fileURLToPath(moduleUrl))
  for (let directory = start; ; directory = dirname(directory)) {
    const version = versionOf(join(directory, "package.json"))
    if (version !== undefined) return version
    if (dirname(directory) === directory) break
  }
  throw new Error(`omo-senpi package manifest not found above ${start}; reinstall omo`)
}
