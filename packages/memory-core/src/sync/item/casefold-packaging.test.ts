import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, parse } from "node:path"

// The fold table ships as a file-loader asset. A plain `bun build` bundle names it relative to the
// bundle, so the loader must anchor that path to its own module dir, not to the process cwd.
test("a plain bun build bundle folds case from the filesystem root cwd", () => {
  const work = mkdtempSync(join(tmpdir(), "casefold-bundle-"))
  try {
    const entry = join(work, "entry.ts")
    writeFileSync(entry, [
      `import { caseFold } from ${JSON.stringify(join(import.meta.dir, "casefold.ts"))}`,
      'console.log(caseFold("Straße") === "strasse" ? "casefold-ok" : "casefold-wrong")',
    ].join("\n"))
    const outdir = join(work, "out")
    const build = Bun.spawnSync([process.execPath, "build", "--target=node", entry, "--outdir", outdir], { cwd: work })
    expect(build.exitCode, build.stderr.toString()).toBe(0)
    const run = Bun.spawnSync([process.execPath, join(outdir, "entry.js")], { cwd: parse(process.cwd()).root })
    expect(run.stdout.toString(), run.stderr.toString()).toContain("casefold-ok")
    expect(run.exitCode, run.stderr.toString()).toBe(0)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}, 20000)
