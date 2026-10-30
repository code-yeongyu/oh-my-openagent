import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

export interface GlobalBinFixture {
  readonly root: string
  readonly binDir: string
  readonly binPath: string
  readonly packageDir: string
}

export interface GlobalBinFixtureOptions {
  readonly root: string
  readonly packageName: string
  readonly version: string
  readonly bins?: readonly string[]
  readonly link?: "symlink" | "script"
}

export function createBinFixtureRoot(label: string): string {
  return mkdtempSync(join(tmpdir(), `omo-bin-${label}-`))
}

/**
 * Lays out a global install the way npm and bun really do it: the package under
 * `lib/node_modules/<name>`, and one entry per bin in `bin/`, either a relative symlink
 * (npm and bun on POSIX) or a launcher script that names the package path (Windows shims and
 * omo-ai's own bun shim).
 */
export function writeGlobalPackageBin(options: GlobalBinFixtureOptions): GlobalBinFixture {
  const packageDir = join(options.root, "lib", "node_modules", ...options.packageName.split("/"))
  const entryPath = join(packageDir, "bin", "cli.js")
  const binDir = join(options.root, "bin")
  mkdirSync(join(packageDir, "bin"), { recursive: true })
  mkdirSync(binDir, { recursive: true })
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify({ name: options.packageName, version: options.version, bin: { omo: "bin/cli.js" } }),
  )
  writeFileSync(entryPath, "#!/usr/bin/env node\n")

  const bins = options.bins ?? ["omo"]
  for (const bin of bins) {
    const binPath = join(binDir, bin)
    if ((options.link ?? "symlink") === "symlink") symlinkSync(relative(binDir, entryPath), binPath)
    else writeFileSync(binPath, `#!/bin/sh\nexec bun "${entryPath}" "$@"\n`, { mode: 0o755 })
  }

  return { root: options.root, binDir, binPath: join(binDir, bins[0] ?? "omo"), packageDir }
}

/**
 * Lays out the `omo` command the Codex Light installer of a pre-rename release wrote into
 * `~/.local/bin`: a generated shell wrapper, not a package-manager link, that execs the CLI out of
 * `<CODEX_HOME>/plugins/cache/sisyphuslabs/omo/<version>/`. The marker comment is what the Light
 * installer itself matches on when it retires the wrapper.
 */
export function writeCodexLightRuntimeWrapper(options: {
  readonly root: string
  readonly version: string
  readonly marker?: string
}): { readonly binDir: string; readonly binPath: string } {
  const binDir = join(options.root, ".local", "bin")
  const cliPath = join(options.root, ".codex", "plugins", "cache", "sisyphuslabs", "omo", options.version, "dist", "cli", "index.js")
  mkdirSync(binDir, { recursive: true })
  const binPath = join(binDir, "omo")
  writeFileSync(
    binPath,
    ["#!/bin/sh", `# ${options.marker ?? "OMO_GENERATED_RUNTIME_WRAPPER"}`, `exec bun "${cliPath}" "$@"`, ""].join("\n"),
    { mode: 0o755 },
  )
  return { binDir, binPath }
}
