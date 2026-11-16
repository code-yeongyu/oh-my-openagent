import { readdirSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

const FIXTURE_DATA = /conformance|electron/i

export function profileRoots(home: string = homedir(), env: NodeJS.ProcessEnv = process.env): string[] {
  const fromEnv = [env.APPDATA, env.LOCALAPPDATA].filter((path) => path !== undefined && path !== "")
  const library = join(home, "Library")
  return [
    tmpdir(),
    join(home, ".config"),
    join(home, ".local", "share"),
    join(home, ".cache"),
    join(library, "Application Support"),
    join(library, "WebKit"),
    join(library, "Caches"),
    join(library, "HTTPStorages"),
    join(library, "Saved Application State"),
    join(library, "Preferences"),
    ...fromEnv.map(String),
  ]
}

/** Every entry in the given roots whose name looks like fixture or Electron data. */
export function fixtureDataEntries(roots: readonly string[] = profileRoots()): Set<string> {
  const entries = new Set<string>()
  for (const root of roots) {
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

/** Fixture data present now that was not in the baseline, which the driver takes once before the first leg. */
export function leftoversSince(baseline: ReadonlySet<string>, roots: readonly string[] = profileRoots()): string[] {
  return [...fixtureDataEntries(roots)].filter((entry) => !baseline.has(entry))
}
