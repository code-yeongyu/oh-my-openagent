import { accessSync, constants } from "node:fs"
import { delimiter, join } from "node:path"

export function findOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  // Windows runs only a name with a PATHEXT extension, so those come first in each directory: npm puts an extensionless sh
  // shim (`bun`, `claude`) next to its `.cmd` (#14003 review L2). The bare name stays last for a command that already
  // carries its extension.
  const names =
    platform === "win32"
      ? [...(env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((ext) => `${command}${ext.toLowerCase()}`), command]
      : [command]
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
