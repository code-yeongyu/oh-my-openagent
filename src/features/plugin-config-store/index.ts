import { readFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { OhMyOpenCodeConfigSchema } from "../../config"
import type { OhMyOpenCodeConfig } from "../../config"

export class PluginConfigStore {
  private current: OhMyOpenCodeConfig
  private configPath: string

  constructor(initial: OhMyOpenCodeConfig, configPath: string) {
    this.current = { ...initial }
    this.configPath = configPath
  }

  get(): OhMyOpenCodeConfig {
    return this.current
  }

  async reload(): Promise<{ ok: boolean; errors?: string[] }> {
    try {
      const configDir = this.configPath.endsWith(".json") || this.configPath.endsWith(".jsonc")
        ? dirname(this.configPath) : this.configPath
      const candidates = [
        join(configDir, "oh-my-opencode.jsonc"),
        join(configDir, "oh-my-opencode.json"),
        join(configDir, ".opencode/oh-my-opencode.jsonc"),
      ]
      let raw: string | null = null
      for (const f of candidates) {
        if (existsSync(f)) {
          raw = readFileSync(f, "utf-8")
          break
        }
      }
      if (!raw) return { ok: false, errors: ["No config file found"] }
      const parsed = JSON.parse(raw)
      const result = OhMyOpenCodeConfigSchema.safeParse(parsed)
      if (!result.success) {
        return { ok: false, errors: result.error.issues.map(i => i.message) }
      }
      this.current = result.data
      return { ok: true }
    } catch (e) {
      return { ok: false, errors: [String(e)] }
    }
  }

  getValue(path: string): unknown {
    const parts = path.split(".")
    let val: unknown = this.current
    for (const p of parts) {
      if (val && typeof val === "object" && p in (val as Record<string, unknown>)) {
        val = (val as Record<string, unknown>)[p]
      } else {
        return undefined
      }
    }
    return val
  }

  async setValue(path: string, value: string): Promise<{ ok: boolean; errors?: string[] }> {
    const parts = path.split(".")
    let obj: Record<string, unknown> = this.current as unknown as Record<string, unknown>
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]] || typeof obj[parts[i]] !== "object") {
        obj[parts[i]] = {}
      }
      obj = obj[parts[i]] as Record<string, unknown>
    }
    const lastKey = parts[parts.length - 1]
    // Try parsing as number or boolean
    if (value === "true") obj[lastKey] = true
    else if (value === "false") obj[lastKey] = false
    else if (!isNaN(Number(value)) && value.trim() !== "") obj[lastKey] = Number(value)
    else obj[lastKey] = value
    return { ok: true }
  }
}

export function createConfigStore(config: OhMyOpenCodeConfig, configPath: string): PluginConfigStore {
  return new PluginConfigStore(config, configPath)
}
