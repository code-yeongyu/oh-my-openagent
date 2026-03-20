import { join } from "path"

import { getDataDir, getOpenCodeConfigDir } from "../../shared"

export function getLspServerAdditionalPathBases(workingDirectory: string): string[] {
  const configDir = getOpenCodeConfigDir({ binary: "opencode" })
  const dataDir = join(getDataDir(), "opencode")

  return [
    join(workingDirectory, "node_modules", ".bin"),
    join(configDir, "bin"),
    join(configDir, "node_modules", ".bin"),
    join(dataDir, "bin"),
    join(dataDir, "bin", "node_modules", ".bin"),
  ]
}
