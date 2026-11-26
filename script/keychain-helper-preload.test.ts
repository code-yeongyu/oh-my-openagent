import { expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

// The keychain-helper guard (keychain-helper/test-preload.ts) holds only where tests run under the hermetic-home
// preload, which marks the stand-in for the OS store. Bun reads the bunfig.toml of the directory tests start in, so
// every package whose tests can reach the account core must load that preload itself (review 6067451001 M1).

const ROOT = resolve(import.meta.dir, "..")
const PACKAGES = join(ROOT, "packages")
const REACHES_ACCOUNT_CORE = /@oh-my-opencode\/account-core|account-core\/src\//

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) return []
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.(ts|mts|js|mjs)$/.test(entry.name) ? [path] : []
  })
}

const reachesAccountCore = (pkg: string): boolean =>
  pkg === "account-core" ||
  ["src", "test", "bin"].some(
    (sub) =>
      existsSync(join(PACKAGES, pkg, sub)) &&
      sources(join(PACKAGES, pkg, sub)).some((file) => REACHES_ACCOUNT_CORE.test(readFileSync(file, "utf8"))),
  )

function preloads(pkg: string): string[] {
  const config = join(PACKAGES, pkg, "bunfig.toml")
  if (!existsSync(config)) return []
  const line = /^preload\s*=\s*\[([^\]]*)\]/m.exec(readFileSync(config, "utf8"))?.[1] ?? ""
  return [...line.matchAll(/"([^"]+)"/g)].map((match) => resolve(dirname(config), match[1] ?? ""))
}

const installsHermeticHome = (file: string): boolean =>
  file.endsWith(`${ROOT}/test-setup.ts`) || /installHermeticHome\(/.test(readFileSync(file, "utf8"))

test("#given every package whose tests reach the account core #then its own test config loads the hermetic-home preload", () => {
  const missing = readdirSync(PACKAGES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(PACKAGES, entry.name, "package.json")))
    .map((entry) => entry.name)
    .filter(reachesAccountCore)
    .filter((pkg) => !preloads(pkg).some(installsHermeticHome))
  expect(missing).toEqual([])
})
