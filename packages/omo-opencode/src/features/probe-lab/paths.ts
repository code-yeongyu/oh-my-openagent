import * as path from "node:path"
import { mkdirSync } from "node:fs"
import { getDataDir } from "../../shared/data-path"

const ROOT_SUBDIR = "idm/probe-lab"

export function getProbeLabRoot(): string {
  const dir = path.join(getDataDir(), ROOT_SUBDIR)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getDefaultDbPath(): string {
  return path.join(getProbeLabRoot(), "lab.db")
}
