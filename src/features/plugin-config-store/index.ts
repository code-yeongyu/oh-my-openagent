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

  get(): OhMyOpenCodeConfig { return this.current }

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
      for (const f of candidates) { if (existsSync(f)) { raw = readFileSync(f, "utf-8"); break } }
      if (!raw) return { ok: false, errors: ["No config file found"] }
      const parsed = JSON.parse(raw)
      const result = OhMyOpenCodeConfigSchema.safeParse(parsed)
      if (!result.success) return { ok: false, errors: result.error.issues.map(i => i.message) }
      this.current = result.data
      return { ok: true }
    } catch (e) { return { ok: false, errors: [String(e)] } }
  }
}
