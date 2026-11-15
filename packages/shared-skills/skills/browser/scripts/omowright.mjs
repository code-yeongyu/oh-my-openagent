import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { guardOmowright } from "./browser-engine-guard.mjs"

export { BROWSER_ENGINE_ENV, BuiltinBrowserUnavailableError, guardOmowright } from "./browser-engine-guard.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const skillRoot = dirname(scriptDir)

export function resolveOmowrightEntry(env = process.env) {
  const packageRoot = join(skillRoot, "..", "..", "..", "..", "node_modules", "omowright")
  // Same order as stage-omowright-runtime.mjs: sources before the build, `.ts` before `.js`. A git
  // install carries the sources (TypeScript since omowright's strict port, which only Bun imports);
  // a package built for its `exports` carries `dist/` only.
  const candidates = [
    env.OMOWRIGHT_ROOT ? join(env.OMOWRIGHT_ROOT, "index.js") : undefined,
    join(skillRoot, "runtime", "omowright", "index.js"),
    join(packageRoot, "src", "index.ts"),
    join(packageRoot, "src", "index.js"),
    join(packageRoot, "dist", "index.js"),
  ].filter((candidate) => candidate !== undefined)
  return candidates.find((candidate) => existsSync(candidate))
}

function kernelHost() {
  const { tool, tool_schema: toolSchema } = globalThis
  if (typeof toolSchema !== "function" || tool === undefined || tool === null) return undefined
  return {
    async listTools() {
      const listed = await toolSchema()
      return Array.isArray(listed?.tools) ? listed.tools : []
    },
    async callTool(name, args) {
      return await tool[name](args)
    },
  }
}

export async function loadOmowright(env = process.env, host = kernelHost()) {
  const entry = resolveOmowrightEntry(env)
  if (entry === undefined) {
    throw new Error(
      "omowright is not staged in this skill; run `node packages/shared-skills/stage-omowright-runtime.mjs` in a checkout, or set OMOWRIGHT_ROOT to a directory holding its bundled index.js",
    )
  }
  const raw = await import(pathToFileURL(entry).href)
  return { entry, omowright: guardOmowright(raw, { env, host }) }
}
