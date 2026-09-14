import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { prepareCompileSafeEngine } from "./lib/compile-safe-engine.js"

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

const claudeCodeVersionRelative = "node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js"
const claudeCodeVersionPattern = /const claudeCodeVersion = "(\d+)\.(\d+)\.(\d+)";/
const claudeCodeVersionFloor = "2.1.251"

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

// --thinking / model-derived thinking is a session override. The published Senpi
// startup path re-applies the already-selected level through the persistent setter,
// which writes modelThinkingLevels even when defaultThinkingLevel stays unchanged
// (https://github.com/code-yeongyu/oh-my-openagent/issues/8116).
const cliThinkingMainRelative = "dist/main.js"
const cliThinkingPersistentApply =
  "created.session.setThinkingLevel(created.session.thinkingLevel)"
const cliThinkingSessionApply =
  "created.session.setSessionThinkingLevel(created.session.thinkingLevel)"
const cliThinkingMainPath = join(senpiRoot, cliThinkingMainRelative)
if (!existsSync(cliThinkingMainPath)) throw new Error(`omo-ai: installed Senpi target is missing: ${cliThinkingMainRelative}`)
const cliThinkingSource = readFileSync(cliThinkingMainPath, "utf8")
if (cliThinkingSource.includes(cliThinkingPersistentApply)) {
  writeFileSync(cliThinkingMainPath, cliThinkingSource.replaceAll(cliThinkingPersistentApply, cliThinkingSessionApply))
} else if (!cliThinkingSource.includes(cliThinkingSessionApply)) {
  throw new Error(`omo-ai: unsupported Senpi ${cliThinkingMainRelative}`)
}

prepareCompileSafeEngine(senpiRoot)
