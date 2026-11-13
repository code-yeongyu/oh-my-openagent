import { readdirSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

const FIXTURE_DATA = /conformance|electron/i

function profileRoots(): string[] {
  const home = homedir()
  const fromEnv = [process.env.APPDATA, process.env.LOCALAPPDATA].filter((path) => path !== undefined && path !== "")
  return [
    tmpdir(),
    join(home, ".config"),
    join(home, ".local", "share"),
    join(home, ".cache"),
    join(home, "Library", "Application Support"),
    join(home, "Library", "WebKit"),
    join(home, "Library", "Caches"),
    ...fromEnv.map(String),
  ]
}

/** Every entry in a user profile or temp location whose name looks like fixture or Electron data. */
export function fixtureDataEntries(): Set<string> {
  const entries = new Set<string>()
  for (const root of profileRoots()) {
    let names: string[]
    try {
      names = readdirSync(root)
    } catch {
      continue
    }
    for (const name of names) if (FIXTURE_DATA.test(name)) entries.add(join(root, name))
  }
  return entries
}
