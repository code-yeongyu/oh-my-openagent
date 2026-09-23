import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const claudeCodeVersionRelative = "node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js"
const claudeCodeVersionPattern = /const claudeCodeVersion = "(\d+)\.(\d+)\.(\d+)";/
// Claude Opus 5.5 rejects OAuth requests advertising Claude Code below 2.1.280 (claude_code_version_too_old).
export const claudeCodeVersionFloor = "2.1.280"
const [floorMajor, floorMinor, floorPatch] = claudeCodeVersionFloor.split(".").map(Number)

function isBelowFloor([major, minor, patch]) {
  return major < floorMajor ||
    (major === floorMajor && (minor < floorMinor || (minor === floorMinor && patch < floorPatch)))
}

function floorPiAi(senpiRoot) {
  const path = join(senpiRoot, claudeCodeVersionRelative)
  if (!existsSync(path)) throw new Error(`omo-ai: installed Senpi target is missing: ${claudeCodeVersionRelative}`)
  const source = readFileSync(path, "utf8")
  const match = claudeCodeVersionPattern.exec(source)
  if (match === null) throw new Error(`omo-ai: unsupported Senpi ${claudeCodeVersionRelative}`)
  if (!isBelowFloor(match.slice(1).map(Number))) return
  writeFileSync(path, source.replace(claudeCodeVersionPattern, `const claudeCodeVersion = "${claudeCodeVersionFloor}";`))
}

// The launcher runs the engine's pre-linked dist/bundle/cli.js whenever it exists, and that bundle
// inlines its own claudeCodeVersion, so the pi-ai file above never reaches the running engine.
// Every bundled declaration gets the same floor; only the version string is rewritten.
function floorEngineBundle(senpiRoot) {
  const bundleRelative = "dist/bundle"
  const bundlePath = join(senpiRoot, bundleRelative)
  if (!existsSync(bundlePath)) return
  const declarationPattern = /\bclaudeCodeVersion\s*=\s*"(\d+)\.(\d+)\.(\d+)"/g
  let declarations = 0
  for (const relative of readdirSync(bundlePath, { recursive: true })) {
    if (!relative.endsWith(".js")) continue
    const path = join(bundlePath, relative)
    const source = readFileSync(path, "utf8")
    let raised = false
    const next = source.replace(declarationPattern, (declaration, major, minor, patch) => {
      declarations++
      if (!isBelowFloor([major, minor, patch].map(Number))) return declaration
      raised = true
      return declaration.replace(/"[^"]*"$/, `"${claudeCodeVersionFloor}"`)
    })
    if (raised) writeFileSync(path, next)
  }
  if (declarations === 0) throw new Error(`omo-ai: unsupported Senpi ${bundleRelative}: no claudeCodeVersion declaration`)
}

export function floorClaudeCodeVersion(senpiRoot) {
  floorPiAi(senpiRoot)
  floorEngineBundle(senpiRoot)
}
