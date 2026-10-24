// Contract: the vendored store stays code-identical to the pinned senpi store (omo-opencode cannot depend on senpi).
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const vendoredPath = join(import.meta.dir, "env-grants-store.ts")
const senpiPackageDir = join(import.meta.dir, "../../../../node_modules/@code-yeongyu/senpi")
const STORE_EXPORT = "./mcp-env-grants"

function normalizedCode(source: string, loader: "ts" | "js"): string {
  const javascript = new Bun.Transpiler({ loader, target: "node" }).transformSync(source)
  return new Bun.Transpiler({ loader: "js", target: "node", minifyWhitespace: true })
    .transformSync(javascript)
    .replace(/\/\/# sourceMappingURL=.*$/m, "")
}

function pinnedStoreModule(): string | undefined {
  const manifest: unknown = JSON.parse(readFileSync(join(senpiPackageDir, "package.json"), "utf8"))
  const exportsMap = typeof manifest === "object" && manifest !== null && "exports" in manifest ? manifest.exports : undefined
  const entry = typeof exportsMap === "object" && exportsMap !== null && STORE_EXPORT in exportsMap ? exportsMap[STORE_EXPORT] : undefined
  if (entry === undefined) return undefined
  const target = typeof entry === "object" && entry !== null && "import" in entry ? entry.import : entry
  if (typeof target !== "string") throw new Error(`senpi's ${STORE_EXPORT} export has no import path`)
  return join(senpiPackageDir, target)
}

test("vendored env-grants-store has the same code as the pinned senpi store", () => {
  const storeModule = pinnedStoreModule()
  // A pin from before senpi#3818 exports no store and has nothing to compare; any pin that exports it must match.
  if (storeModule === undefined) return
  const vendored = normalizedCode(readFileSync(vendoredPath, "utf8"), "ts")
  const senpi = normalizedCode(readFileSync(storeModule, "utf8"), "js")
  expect(vendored).toBe(senpi)
})
