import { describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, parse, relative } from "node:path"

// Packaging contracts for the embedded Loro runtime:
// 1. A plain `bun build` bundle (no --compile) must initialize the loader from ANY cwd -
//    the file loader emits a path relative to the bundle, which the loader must anchor to
//    its own module dir instead of the process cwd.
// 2. The raw glue module `loro_wasm_bg.js` is a process-wide singleton: any other import of
//    the `loro-crdt` package runs its own instantiation and swaps the wasm memory under every
//    live doc. The loader is the only sanctioned loro-crdt importer.

const LOADER_PATH = join(import.meta.dir, "loro-runtime.ts")
const PACKAGES_ROOT = join(import.meta.dir, "..", "..", "..")
const GLUE_IMPORT = /(?:from\s*|import\s*\(\s*|import\s+|require\s*\(\s*)["']loro-crdt(?:["'./])/

function collectSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue
    if (statSync(full).isDirectory()) {
      files.push(...collectSourceFiles(full))
      continue
    }
    if (/\.(?:ts|tsx|js|mjs|cts|mts)$/.test(entry)) files.push(full)
  }
  return files
}

describe("loro runtime packaging", () => {
  test("a plain bun build bundle of the loader initializes from the filesystem root cwd", () => {
    const work = mkdtempSync(join(tmpdir(), "loro-bundle-"))
    try {
      const entry = join(work, "entry.ts")
      writeFileSync(entry, [
        `import { loadLoroRuntime } from ${JSON.stringify(LOADER_PATH)}`,
        "const { LoroDoc } = await loadLoroRuntime()",
        "const doc = new LoroDoc()",
        "try {",
        '  doc.getText("t").insert(0, "hi")',
        "  doc.commit()",
        '  console.log("bundle-loader-ok")',
        "} finally {",
        "  doc.free()",
        "}",
      ].join("\n"))
      const outdir = join(work, "out")
      const build = Bun.spawnSync([process.execPath, "build", "--target=bun", entry, "--outdir", outdir], { cwd: work })
      expect(build.stderr.toString(), "bun build stderr").toBe("")
      expect(build.exitCode, "bun build exit code").toBe(0)
      const bundle = join(outdir, "entry.js")
      const probe = Bun.spawnSync([process.execPath, bundle], { cwd: work })
      expect(probe.exitCode, `same-cwd baseline run (stderr: ${probe.stderr.toString()})`).toBe(0)
      // Any cwd that is not the bundle dir exposes a cwd-relative wasm path; the fs root is the
      // portable spelling of that on every platform ("/" on POSIX, the drive root on Windows).
      const root = parse(process.cwd()).root
      const run = Bun.spawnSync([process.execPath, bundle], { cwd: root })
      expect(run.stdout.toString(), "bundle stdout").toContain("bundle-loader-ok")
      expect(run.exitCode, `bundle exit code (stderr: ${run.stderr.toString()})`).toBe(0)
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  }, 20000)

  test("no package source imports loro-crdt outside the loader", () => {
    const sanctioned = new Set([
      LOADER_PATH,
      join(import.meta.dir, "loro-wasm.d.ts"),
    ])
    const offenders = collectSourceFiles(PACKAGES_ROOT)
      .filter((file) => !sanctioned.has(file))
      .filter((file) => GLUE_IMPORT.test(readFileSync(file, "utf8")))
      .map((file) => relative(PACKAGES_ROOT, file))
    expect(offenders).toEqual([])
  })
})
