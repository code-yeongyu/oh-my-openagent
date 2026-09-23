import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { prepareCompileSafeEngine } from "./lib/compile-safe-engine.js"
import { prepareRpcStreamErrors } from "./lib/rpc-stream-errors.js"
import { patchRpcCloseOrdering } from "./lib/rpc-close-ordering.js"
import { patchWatcherShutdown } from "./lib/watcher-shutdown.js"

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
// Claude Opus 5.5 rejects OAuth requests advertising Claude Code below 2.1.280 (claude_code_version_too_old).
const claudeCodeVersionFloor = "2.1.280"
const [floorMajor, floorMinor, floorPatch] = claudeCodeVersionFloor.split(".").map(Number)

function isBelowFloor([major, minor, patch]) {
  return major < floorMajor ||
    (major === floorMajor && (minor < floorMinor || (minor === floorMinor && patch < floorPatch)))
}

const claudeCodeVersionPath = join(senpiRoot, claudeCodeVersionRelative)
if (!existsSync(claudeCodeVersionPath)) throw new Error(`omo-ai: installed Senpi target is missing: ${claudeCodeVersionRelative}`)
const claudeCodeSource = readFileSync(claudeCodeVersionPath, "utf8")
const claudeCodeMatch = claudeCodeVersionPattern.exec(claudeCodeSource)
if (claudeCodeMatch === null) throw new Error(`omo-ai: unsupported Senpi ${claudeCodeVersionRelative}`)
if (isBelowFloor(claudeCodeMatch.slice(1).map(Number))) {
  writeFileSync(
    claudeCodeVersionPath,
    claudeCodeSource.replace(claudeCodeVersionPattern, `const claudeCodeVersion = "${claudeCodeVersionFloor}";`),
  )
}

// The launcher runs the engine's pre-linked dist/bundle/cli.js whenever it exists, and that bundle
// inlines its own claudeCodeVersion, so the pi-ai file above never reaches the running engine.
// Every bundled declaration gets the same floor; only the version string is rewritten.
const claudeCodeBundleRelative = "dist/bundle"
const claudeCodeBundlePath = join(senpiRoot, claudeCodeBundleRelative)
if (existsSync(claudeCodeBundlePath)) {
  const bundledDeclarationPattern = /\bclaudeCodeVersion\s*=\s*"(\d+)\.(\d+)\.(\d+)"/g
  let bundledDeclarations = 0
  for (const relative of readdirSync(claudeCodeBundlePath, { recursive: true })) {
    if (!relative.endsWith(".js")) continue
    const path = join(claudeCodeBundlePath, relative)
    const source = readFileSync(path, "utf8")
    let raised = false
    const next = source.replace(bundledDeclarationPattern, (declaration, major, minor, patch) => {
      bundledDeclarations++
      if (!isBelowFloor([major, minor, patch].map(Number))) return declaration
      raised = true
      return declaration.replace(/"[^"]*"$/, `"${claudeCodeVersionFloor}"`)
    })
    if (raised) writeFileSync(path, next)
  }
  if (bundledDeclarations === 0) throw new Error(`omo-ai: unsupported Senpi ${claudeCodeBundleRelative}: no claudeCodeVersion declaration`)
}

prepareCompileSafeEngine(senpiRoot)
prepareRpcStreamErrors(senpiRoot)
patchRpcCloseOrdering(senpiRoot)
patchWatcherShutdown(senpiRoot)
