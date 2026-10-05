import { createHash } from "node:crypto"
import { lstat, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { writeFileAtomic } from "./codex-config-atomic-write"
import { hasForeignAgentRegistration } from "./codex-config-agents"
import { parseAgentHeaderName, splitTomlSections } from "./codex-config-toml-sections"
import type { LinkedAgent } from "./link-cached-plugin-agents"

const REGISTRATION = { name: "default", configFile: "./agents/default.toml" }

// A receipt of the exact installed bytes distinguishes an upgrade from user customization.
// Never claim an existing default merely because it has our name or a familiar model.
export async function installDefaultAgentRole(input: {
  readonly codexHome: string
  readonly worker: LinkedAgent
  readonly enabled: boolean
}): Promise<LinkedAgent | null> {
  const target = join(input.codexHome, "agents", "default.toml")
  const receipt = join(input.codexHome, "agents", ".lazycodex-default.sha256")
  const configPath = join(input.codexHome, "config.toml")
  const config = await readIfPresent(configPath)
  const entry = await lstat(target).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  })
  if (entry !== null && !entry.isFile()) {
    if (!input.enabled) return null
    throw new Error("Preserved user-owned agents/default.toml: refusing to replace a symlink or directory")
  }
  const existing = await readIfPresent(target)
  const digest = await readIfPresent(receipt)
  const owned = existing !== null && digest === hash(existing)
  const foreign = hasForeignAgentRegistration(config ?? "", REGISTRATION)

  if (!input.enabled) {
    if (owned) {
      if (!foreign && config !== null) {
        const next = splitTomlSections(config)
          .filter((section) => section.header === null || parseAgentHeaderName(section.header) !== "default")
          .map((section) => section.text).join("")
        if (next !== config) await writeFileAtomic(configPath, next)
      }
      await rm(target)
      await rm(receipt)
    }
    return null
  }
  if (foreign || (existing !== null && !owned)) {
    throw new Error("Preserved user-owned agents.default / agents/default.toml. Move it aside to install the LazyCodex fallback, or set [codex].agents.default.disable = true in omo.jsonc. Explicit LazyCodex roles remain required.")
  }
  const worker = await readFile(input.worker.path, "utf8")
  const content = worker.replace(/^name\s*=\s*["']lazycodex-worker-medium["']\s*$/m, 'name = "default"')
  if (content === worker) throw new Error("Cannot derive default: medium worker has no matching internal name")
  await writeFileAtomic(target, content)
  await writeFileAtomic(receipt, hash(content))
  return { name: "default.toml", path: target, target: input.worker.target }
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}
