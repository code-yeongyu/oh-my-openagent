// Builds the standalone `@oh-my-opencode/omo-gateway/conformance` distribution in dist/conformance:
// one self-contained ESM bundle of the conformance entry (contract, rich body, capability refusals,
// the checks, FakePlatform/FakeAdapter), its type declarations, and a package.json with no
// dependencies. The source package depends on workspace packages (memory-core for the rules store),
// so it cannot be installed by path outside this repo; this directory can.
//
//   bun run build:conformance            -> packages/omo-gateway/dist/conformance
//   bun scripts/build-conformance.ts DIR -> DIR
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

const PACKAGE_DIR = resolve(import.meta.dir, "..")
const ENTRY = join(PACKAGE_DIR, "src/adapter/conformance.ts")
export const DEFAULT_OUT_DIR = join(PACKAGE_DIR, "dist/conformance")
export const BUNDLE_FILE = "conformance.js"
export const TYPES_FILE = "types/adapter/conformance.d.ts"

export type ConformanceManifest = {
  name: string
  version: string
  description: string
  private: true
  type: "module"
  exports: { "./conformance": { types: string; import: string; default: string } }
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g

/** Module specifiers in built code that would need an installed package (anything not relative, absolute or `node:`). */
export function bareImports(code: string): string[] {
  const found = new Set<string>()
  for (const match of code.matchAll(SPECIFIER)) {
    const specifier = match[1]
    if (specifier === undefined || /^(\.{1,2}\/|\/|node:)/.test(specifier)) continue
    found.add(specifier)
  }
  return [...found]
}

async function sourceManifest(): Promise<{ name: string; version: string }> {
  const parsed: unknown = JSON.parse(await readFile(join(PACKAGE_DIR, "package.json"), "utf8"))
  if (typeof parsed !== "object" || parsed === null) throw new Error("package.json is not an object")
  const name = Reflect.get(parsed, "name")
  const version = Reflect.get(parsed, "version")
  if (typeof name !== "string" || typeof version !== "string") throw new Error("package.json lacks name/version")
  return { name, version }
}

/** Bundle the entry and write the dependency-free manifest. Throws if any bare import survives bundling. */
export async function bundleConformance(outDir: string): Promise<{ bundlePath: string; manifest: ConformanceManifest }> {
  await mkdir(outDir, { recursive: true })
  const result = await Bun.build({ entrypoints: [ENTRY], outdir: outDir, target: "node", format: "esm", naming: BUNDLE_FILE })
  if (!result.success) throw new Error(`bun build failed:\n${result.logs.map(String).join("\n")}`)
  const bundlePath = join(outDir, BUNDLE_FILE)
  const leftovers = bareImports(await readFile(bundlePath, "utf8"))
  if (leftovers.length > 0) throw new Error(`conformance bundle still imports packages: ${leftovers.join(", ")}`)
  const { name, version } = await sourceManifest()
  const manifest: ConformanceManifest = {
    name,
    version,
    description: "Standalone adapter conformance entry of omo-gateway: contract types, runAdapterConformance, FakePlatform.",
    private: true,
    type: "module",
    exports: { "./conformance": { types: `./${TYPES_FILE}`, import: `./${BUNDLE_FILE}`, default: `./${BUNDLE_FILE}` } },
  }
  await writeFile(join(outDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  return { bundlePath, manifest }
}

/** Emit declarations for the entry's import graph only (never the rules store or other workspace-backed modules). */
export async function emitConformanceTypes(outDir: string): Promise<void> {
  const emitted = await Bun.$`bunx tsgo -p tsconfig.conformance.json --outDir ${join(outDir, "types")}`.cwd(PACKAGE_DIR).nothrow().quiet()
  if (emitted.exitCode !== 0) throw new Error(`tsgo declaration emit failed:\n${emitted.stdout}${emitted.stderr}`)
}

if (import.meta.main) {
  const outDir = resolve(process.argv[2] ?? DEFAULT_OUT_DIR)
  await rm(outDir, { recursive: true, force: true })
  const { bundlePath } = await bundleConformance(outDir)
  await emitConformanceTypes(outDir)
  if (!(await Bun.file(join(outDir, TYPES_FILE)).exists())) throw new Error(`missing ${TYPES_FILE} after declaration emit`)
  console.log(`built ${bundlePath}\ninstall with: bun add file:${outDir}`)
}
