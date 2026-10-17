import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getDesktopEngineHost, locateDesktopEngine } from "../packages/senpi-desktop-engine/src/locator"
import { stageCompiledDesktopEngine } from "./release-desktop-engine-target"

export function proveStagedDesktopEngine(stageDir?: string): string {
  const root = stageDir ?? mkdtempSync(join(tmpdir(), "omo-desktop-ci-proof-"))
  try {
    const host = getDesktopEngineHost()
    const target = host === "win32-x64" ? "windows-x64" : host
    const staged = stageCompiledDesktopEngine(target, root)
    if (staged === null) throw new Error(`desktop engine not declared available for ${host}`)
    const previous = process.env.OMO_PACKAGE_DIR
    process.env.OMO_PACKAGE_DIR = root
    let located
    try {
      located = locateDesktopEngine({
        execDir: join(root, "no-executable-sidecar"),
        packageDir: join(root, "no-package-prebuild"),
        repoRoot: join(root, "no-dev-build"),
      })
      if (located.path !== join(root, staged)) {
        throw new Error(`staged engine locator mismatch: ${located.path ?? located.diagnostic.cause}`)
      }
      const mode = statSync(located.path).mode & 0o777
      if (host !== "win32-x64" && mode !== 0o755) {
        throw new Error(`staged engine mode is ${mode.toString(8)}, expected 755`)
      }
      const selftest = spawnSync(located.path, ["--selftest"], { encoding: "utf8" })
      if (selftest.status !== 0 || !selftest.stdout.includes("engine: selftest ok")) {
        throw new Error(`staged engine selftest failed: ${selftest.stderr || selftest.stdout}`)
      }
      return `host=${host} path=${staged} mode=${host === "win32-x64" ? "Windows executable" : mode.toString(8)} selftest=${selftest.stdout.trim()} cleanup=${stageDir === undefined ? "removed" : "retained"}`
    } finally {
      if (previous === undefined) delete process.env.OMO_PACKAGE_DIR
      else process.env.OMO_PACKAGE_DIR = previous
    }
  } finally {
    if (stageDir === undefined) rmSync(root, { force: true, recursive: true })
  }
}

if (import.meta.main) {
  console.log(proveStagedDesktopEngine(process.env.OMO_DESKTOP_CI_STAGE_DIR))
}
