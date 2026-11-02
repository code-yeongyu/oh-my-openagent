import { accessSync, constants } from "node:fs"
import { delimiter, join } from "node:path"

export function findOnPath(command: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const names = platform === "win32" ? [command, ...(env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((ext) => `${command}${ext.toLowerCase()}`)] : [command]
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (!directory) continue
    for (const name of names) {
      const candidate = join(directory, name)
      try {
        accessSync(candidate, platform === "win32" ? constants.F_OK : constants.X_OK)
        return candidate
      } catch {
        continue
      }
    }
  }
  return null
}
