import { readFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { OhMyOpenCodeConfigSchema } from "../../config"
import type { OhMyOpenCodeConfig } from "../../config"

const SAFE_PATHS = new Set([
  "agents.$name.model",
  "agents.$name.variant",
  "agents.$name.temperature",
  "agents.$name.top_p",
  "agents.$name.reasoningEffort",
  "agents.$name.thinking.budgetTokens",
  "agents.$name.fallback_models",
  "categories.$name.model",
  "categories.$name.variant",
  "categories.$name.temperature",
  "model_fallback",
])

function isSafePath(path: string): boolean {
  for (const safe of SAFE_PATHS) {
    const parts = path.split(".")
    const safeParts = safe.split(".")
    if (parts.length !== safeParts.length) continue
    let match = true
    for (let i = 0; i < parts.length; i++) {
      if (safeParts[i] === "$name") continue
      if (parts[i] !== safeParts[i]) { match = false; break }
    }
    if (match) return true
  }
  return false
}

export class PluginConfigStore {
  private current: OhMyOpenCodeConfig
  private configPath: string

  constructor(initial: OhMyOpenCodeConfig, configPath: string) {
    this.current = initial
    this.configPath = configPath
  }

  get(): OhMyOpenCodeConfig {
    return this.current
  }

  async reload(): Promise<{ ok: boolean; errors?: string[]; warnings?: string[] }> {
    const errors: string[] = []
    const warnings: string[] = []

    try {
      const configDir = this.configPath.endsWith(".json") || this.configPath.endsWith(".jsonc")
        ? dirname(this.configPath)
        : this.configPath
      const configFiles = [
        join(configDir, "oh-my-opencode.jsonc"),
        join(configDir, "oh-my-opencode.json"),
        join(configDir, ".opencode/oh-my-opencode.jsonc"),
        join(configDir, ".opencode/oh-my-opencode.json"),
      ]

      let raw: string | null = null
      for (const f of configFiles) {
        if (existsSync(f)) {
          raw = readFileSync(f, "utf-8")
          break
        }
      }

      if (!raw) {
        errors.push("No config file found")
        return { ok: false, errors }
      }

      const parsed = JSON.parse(raw)
      const result = OhMyOpenCodeConfigSchema.safeParse(parsed)

      if (!result.success) {
        errors.push(...result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`))
        return { ok: false, errors }
      }

      const oldConfig = this.current
      const newConfig = result.data

      for (const key of Object.keys(newConfig as Record<string, unknown>)) {
        if (key === "agents" || key === "categories" || key === "model_fallback") continue
        const oldVal = (oldConfig as Record<string, unknown>)[key]
        const newVal = (newConfig as Record<string, unknown>)[key]
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          warnings.push(`${key}: requires restart to apply changes`)
        }
      }

      this.current = newConfig
      return { ok: true, warnings: warnings.length > 0 ? warnings : undefined }
    } catch (e) {
      errors.push(String(e))
      return { ok: false, errors }
    }
  }

  getValue(path: string): unknown {
    const parts = path.split(".")
    let obj: unknown = this.current
    for (const part of parts) {
      if (typeof obj !== "object" || obj === null) return undefined
      obj = (obj as Record<string, unknown>)[part]
    }
    return obj
  }

  async setValue(path: string, value: string): Promise<void> {
    if (!isSafePath(path)) {
      throw new Error(`Cannot set '${path}': path is not safe for hot-reload`)
    }
    const parts = path.split(".")
    let obj: Record<string, unknown> = this.current as Record<string, unknown>
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i].replace(/^\d+$/, "") // strip numeric indices for agents.$index
      if (!obj[key] || typeof obj[key] !== "object") {
        obj[key] = {}
      }
      obj = obj[key] as Record<string, unknown>
    }
    const lastKey = parts[parts.length - 1]
    obj[lastKey] = coerceValue(value)
  }
}

function coerceValue(val: string): unknown {
  if (val === "true") return true
  if (val === "false") return false
  if (/^\d+(\.\d+)?$/.test(val)) return Number(val)
  if (val.startsWith("[") && val.endsWith("]")) {
    try { return JSON.parse(val) } catch { return val }
  }
  return val
}
