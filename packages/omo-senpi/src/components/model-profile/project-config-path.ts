import { existsSync } from "node:fs"
import { join } from "node:path"

export function projectConfigPath(cwd: string): string {
  const jsonc = join(cwd, ".omo", "omo.jsonc")
  if (existsSync(jsonc)) return jsonc
  const json = join(cwd, ".omo", "omo.json")
  return existsSync(json) ? json : jsonc
}
