/**
 * QA driver for issue 6620 — real-surface execution of the changed code path.
 *
 * Runs createBackgroundUpdateCheckRunner with REAL filesystem deps
 * (invalidatePackage, existsSync, join, config/cache path resolution) against
 * an isolated XDG sandbox. Only `getLatestVersion` (network) and
 * `getModuleHostingWorkspace` (import.meta.url position, which in production
 * resolves inside the OpenCode per-spec sandbox) are injected.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { createBackgroundUpdateCheckRunner } from "/home/viprix/projects/oom-wt-6620/packages/omo-opencode/src/hooks/auto-update-checker/hook/background-update-check"
import { getOpenCodeCacheDir } from "/home/viprix/projects/oom-wt-6620/packages/omo-opencode/src/shared/data-path"
import { getOpenCodeConfigDir } from "/home/viprix/projects/oom-wt-6620/packages/omo-opencode/src/shared/opencode-config-dir"

const ISO = process.env.ISO_ROOT
if (!ISO) throw new Error("ISO_ROOT not set")
const packagesDir = join(ISO, "cache", "opencode", "packages")
const sandboxDir = join(packagesDir, "oh-my-openagent@latest")
const cfgDir = join(ISO, "cfg", "opencode")
const projDir = join(ISO, "proj")

function seedStaleLayout(): void {
  mkdirSync(join(sandboxDir, "node_modules", "oh-my-openagent"), { recursive: true })
  writeFileSync(
    join(sandboxDir, "package.json"),
    JSON.stringify({ name: "sandbox", dependencies: { "oh-my-openagent": "latest" } }, null, 2),
  )
  writeFileSync(
    join(sandboxDir, "node_modules", "oh-my-openagent", "package.json"),
    JSON.stringify({ name: "oh-my-openagent", version: "4.15.1" }, null, 2),
  )
  mkdirSync(join(packagesDir, "node_modules", "oh-my-openagent"), { recursive: true })
  writeFileSync(
    join(packagesDir, "node_modules", "oh-my-openagent", "package.json"),
    JSON.stringify({ name: "oh-my-openagent", version: "4.15.1" }, null, 2),
  )
  const lock = {
    lockfileVersion: 1,
    packages: {
      "oh-my-openagent@latest": {
        version: "4.15.1",
        resolved: "https://registry.npmjs.org/oh-my-openagent/-/oh-my-openagent-4.15.1.tgz",
      },
    },
  }
  writeFileSync(join(packagesDir, "bun.lock"), JSON.stringify(lock, null, 2))
  mkdirSync(cfgDir, { recursive: true })
  writeFileSync(join(cfgDir, "opencode.json"), JSON.stringify({ plugin: ["oh-my-openagent@latest"] }, null, 2))
  mkdirSync(projDir, { recursive: true })
  writeFileSync(join(projDir, "opencode.json"), JSON.stringify({ plugin: ["oh-my-openagent@latest"] }, null, 2))
}

function assert(condition: boolean, label: string): void {
  console.log(`[${condition ? "PASS" : "FAIL"}] ${label}`)
  if (!condition) process.exitCode = 1
}

seedStaleLayout()

console.log("== path isolation self-proof ==")
const resolvedCache = getOpenCodeCacheDir()
const resolvedCfg = getOpenCodeConfigDir({ binary: "opencode" })
console.log(`resolved cache dir: ${resolvedCache}`)
console.log(`resolved config dir: ${resolvedCfg}`)
assert(resolvedCache.startsWith(join(ISO, "cache")), "code under test resolves cache dir INSIDE sandbox")
assert(resolvedCfg.startsWith(join(ISO, "cfg")), "code under test resolves config dir INSIDE sandbox")

console.log("== before ==")
assert(existsSync(sandboxDir), "stale per-spec sandbox exists")
assert(readFileSync(join(packagesDir, "bun.lock"), "utf-8").includes("4.15.1"), "bun.lock pins stale 4.15.1")
assert(existsSync(join(packagesDir, "node_modules", "oh-my-openagent")), "flat node_modules copy exists")

const runner = createBackgroundUpdateCheckRunner({
  getLatestVersion: async () => "4.19.4",
  getModuleHostingWorkspace: () => sandboxDir,
})

const ctx = {
  directory: projDir,
  client: { tui: { showToast: async () => {} } },
} as unknown as PluginInput
await runner(ctx, true, (_isUpdate, latest) => `v${latest} available. Restart OpenCode to apply.`)

console.log("== after ==")
assert(!existsSync(sandboxDir), "#6620 stale per-spec sandbox removed (reporter's rm -rf step 1)")
assert(!existsSync(join(packagesDir, "node_modules", "oh-my-openagent")), "flat node_modules copy removed (rm -rf step 2)")
const lockAfter = existsSync(join(packagesDir, "bun.lock")) ? readFileSync(join(packagesDir, "bun.lock"), "utf-8") : ""
assert(!lockAfter.includes("oh-my-openagent"), "bun.lock pin purged (rm -rf step 3; next start re-resolves @latest)")
