import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(join(packageRoot, "package.json"))
let senpiRoot = process.env.OMO_SENPI_PATCH_ROOT
try {
  if (senpiRoot === undefined) {
    const searchPaths = require.resolve.paths("@code-yeongyu/senpi") ?? []
    for (const searchPath of searchPaths) {
      const candidate = join(searchPath, "@code-yeongyu", "senpi")
      if (existsSync(join(candidate, "package.json"))) {
        senpiRoot = candidate
        break
      }
    }
    if (senpiRoot === undefined) throw new Error("package root not found in module graph")
  }
} catch (error) {
  throw new Error("omo-ai: unable to resolve the installed @code-yeongyu/senpi package", { cause: error })
}

const transforms = {
  "dist/core/agent-session.js": [
    [
      'import { ModelUsabilityBudgetError, projectModelUsabilityBudget, } from "./extensions/builtin/compaction/model-usability-budget.js";',
      'import { ModelUsabilityBudgetError, projectModelUsabilityBudget, } from "./extensions/builtin/compaction/model-usability-budget.js";\nconst TERRA_FAST_CONTEXT_WINDOW = 650_000;\nfunction normalizeTerraFastModel(model) {\n    if (model?.id !== "gpt-5.6-terra-fast" || model.contextWindow >= TERRA_FAST_CONTEXT_WINDOW)\n        return model;\n    return { ...model, contextWindow: TERRA_FAST_CONTEXT_WINDOW };\n}',
    ],
    [
      "        this.agent = config.agent;",
      "        this.agent = config.agent;\n        this.agent.state.model = normalizeTerraFastModel(this.agent.state.model);",
    ],
    [
      "    async _switchActiveModel(model, opts) {",
      "    async _switchActiveModel(model, opts) {\n        model = normalizeTerraFastModel(model);",
    ],
  ],
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

const claudeCodeVersionRelative = "node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js"
const claudeCodeVersionPattern = /const claudeCodeVersion = "(\d+)\.(\d+)\.(\d+)";/
const claudeCodeVersionFloor = "2.1.251"

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

const claudeCodeVersionPath = join(senpiRoot, claudeCodeVersionRelative)
if (!existsSync(claudeCodeVersionPath)) throw new Error(`omo-ai: installed Senpi target is missing: ${claudeCodeVersionRelative}`)
const claudeCodeSource = readFileSync(claudeCodeVersionPath, "utf8")
const claudeCodeMatch = claudeCodeVersionPattern.exec(claudeCodeSource)
if (claudeCodeMatch === null) throw new Error(`omo-ai: unsupported Senpi ${claudeCodeVersionRelative}`)
const [floorMajor, floorMinor, floorPatch] = claudeCodeVersionFloor.split(".").map(Number)
const [major, minor, patch] = claudeCodeMatch.slice(1).map(Number)
const belowFloor =
  major < floorMajor ||
  (major === floorMajor && (minor < floorMinor || (minor === floorMinor && patch < floorPatch)))
if (belowFloor) {
  writeFileSync(
    claudeCodeVersionPath,
    claudeCodeSource.replace(claudeCodeVersionPattern, `const claudeCodeVersion = "${claudeCodeVersionFloor}";`),
  )
}
