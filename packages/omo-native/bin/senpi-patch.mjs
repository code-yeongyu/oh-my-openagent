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
