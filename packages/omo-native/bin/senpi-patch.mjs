import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(join(packageRoot, "package.json"))
let senpiRoot
try {
  const searchPaths = require.resolve.paths("@code-yeongyu/senpi") ?? []
  for (const searchPath of searchPaths) {
    const candidate = join(searchPath, "@code-yeongyu", "senpi")
    if (existsSync(join(candidate, "package.json"))) {
      senpiRoot = candidate
      break
    }
  }
  if (senpiRoot === undefined) throw new Error("package root not found in module graph")
} catch (error) {
  throw new Error("omo-ai: unable to resolve the installed @code-yeongyu/senpi package", { cause: error })
}

const transforms = {
  "dist/core/extensions/builtin/claude-sdk-oauth/session-registry-pump.js": [
    [
      'throw new SessionTurnAttributionError("Claude SDK OAuth result arrived before replay claim");',
      'throw new SessionTurnAttributionError(describeUnclaimedResult(message));',
    ],
    [
      'function handleMessage(registry, entry, message) {',
      'function describeUnclaimedResult(message) {\n    const errors = Array.isArray(message.errors) ? message.errors : [];\n    const detail = errors.length > 0 ? String(errors[0]) : typeof message.result === "string" ? message.result : typeof message.error === "string" ? message.error : typeof message.terminal_reason === "string" ? message.terminal_reason : undefined;\n    return `Claude SDK OAuth query result${typeof message.subtype === "string" ? ` (${message.subtype})` : ""}${detail ? `: ${detail}` : ""}`;\n}\nfunction handleMessage(registry, entry, message) {',
    ],
  ],
}

for (const [relative, replacements] of Object.entries(transforms)) {
  const path = join(senpiRoot, relative)
  if (!existsSync(path)) throw new Error(`omo-ai: installed Senpi target is missing: ${relative}`)
  let source = readFileSync(path, "utf8")
  if (source.includes("describeUnclaimedResult")) continue
  for (const [from, to] of replacements) {
    if (source.includes(to)) continue
    if (!source.includes(from)) throw new Error(`omo-ai: unsupported Senpi ${relative}`)
    source = source.replace(from, to)
  }
  writeFileSync(path, source)
}
