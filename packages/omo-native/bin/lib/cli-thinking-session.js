import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Startup re-applies a CLI override after model selection. Only that application is session-only;
// RPC and interactive setters still save preferences (oh-my-openagent#8116).
const startupApply = /\bcreated\.session\.(?:setThinkingLevel|setSessionThinkingLevel)\(\s*(?:selection\?\.requested\s*\?\?\s*)?created\.session\.thinkingLevel\s*\)/g

function prepareTargets(senpiRoot, relatives, label) {
  let applications = 0
  for (const relative of relatives) {
    const path = join(senpiRoot, relative)
    const source = readFileSync(path, "utf8")
    const next = source.replace(startupApply, (application) => {
      applications++
      return application.replace(".setThinkingLevel(", ".setSessionThinkingLevel(")
    })
    if (next !== source) writeFileSync(path, next)
  }
  if (applications === 0) throw new Error(`omo-ai: unsupported Senpi ${label}: no CLI thinking application`)
}

export function prepareCliThinkingSession(senpiRoot) {
  const main = "dist/main.js"
  if (!existsSync(join(senpiRoot, main))) throw new Error(`omo-ai: installed Senpi target is missing: ${main}`)
  prepareTargets(senpiRoot, [main], main)
  const bundle = "dist/bundle"
  const bundlePath = join(senpiRoot, bundle)
  if (!existsSync(bundlePath)) return
  const targets = readdirSync(bundlePath, { recursive: true })
    .filter((relative) => relative.endsWith(".js"))
    .map((relative) => join(bundle, relative))
  prepareTargets(senpiRoot, targets, bundle)
}
