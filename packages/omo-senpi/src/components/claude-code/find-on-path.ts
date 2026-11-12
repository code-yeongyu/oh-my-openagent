import { accessSync, constants } from "node:fs"
import { delimiter, isAbsolute, join } from "node:path"

export interface FindOnPathOptions {
  /** Skip relative PATH entries (`.`, `bin`), which resolve against the cwd and so can name a folder's own binaries. */
  readonly absoluteOnly?: boolean
}

export function findOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  options: FindOnPathOptions = {},
): string | null {
  const names =
    platform === "win32"
      ? [command, ...(env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((ext) => `${command}${ext.toLowerCase()}`)]
      : [command]
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (!directory || (options.absoluteOnly === true && !isAbsolute(directory))) continue
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
