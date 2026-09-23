import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const skillRoot = dirname(scriptDir)

export function resolveOmowrightEntry(env = process.env) {
  const candidates = [
    env.OMOWRIGHT_ROOT ? join(env.OMOWRIGHT_ROOT, "index.js") : undefined,
    join(skillRoot, "runtime", "omowright", "index.js"),
    join(skillRoot, "..", "..", "..", "..", "node_modules", "omowright", "src", "index.js"),
  ].filter((candidate) => candidate !== undefined)
  return candidates.find((candidate) => existsSync(candidate))
}

export async function loadOmowright(env = process.env) {
  const entry = resolveOmowrightEntry(env)
  if (entry === undefined) {
    throw new Error(
      "omowright is not staged in this skill; run `node packages/shared-skills/stage-omowright-runtime.mjs` in a checkout, or set OMOWRIGHT_ROOT to a directory holding its bundled index.js",
    )
  }
  return { entry, omowright: await import(pathToFileURL(entry).href) }
}
