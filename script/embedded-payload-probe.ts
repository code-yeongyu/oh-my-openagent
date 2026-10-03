import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { RuntimeManifest } from "./build-omo-binary"
import { relPathForEmbeddedName, RUNTIME_MANIFEST_REL_PATH } from "./embedded-payload-naming"
import { removeTempRoot } from "./remove-temp-root"

const EMBEDDED_PROBE_SOURCE = `import { embeddedFiles } from "bun"
const names = []
let manifest = null
for (const file of embeddedFiles) {
  names.push(file.name)
  if (file.name.endsWith("${RUNTIME_MANIFEST_REL_PATH}")) manifest = JSON.parse(await file.text())
}
console.log(JSON.stringify({ names, manifest }))
`

export interface EmbeddedPayloadReport {
  /** Embedded asset names exactly as bun assigned them. */
  readonly names: readonly string[]
  /** Payload-relative paths recovered from the embedded names. */
  readonly relPaths: readonly string[]
  /** The embedded runtime manifest. */
  readonly manifest: RuntimeManifest
}

/**
 * Reports what a staged payload actually embeds, by compiling a host-target
 * probe against the very same `--asset` directory and running it. The probe
 * shares the build's toolchain, so it also catches a bun that silently drops
 * assets (e.g. a stale bun shadowing PATH).
 */
export function reportEmbeddedPayload(
  stageDir: string,
  removeProbeRoot: (root: string) => void = removeTempRoot,
): EmbeddedPayloadReport {
  const probeRoot = mkdtempSync(join(tmpdir(), "omo-embed-probe-"))
  try {
    const probeEntry = join(probeRoot, "probe.ts")
    const probeBinary = join(probeRoot, "probe")
    writeFileSync(probeEntry, EMBEDDED_PROBE_SOURCE, "utf8")
    const compileArgs = ["build", "--compile", `--asset=${stageDir}`, probeEntry, "--outfile", probeBinary]
    const compiled = spawnSync("bun", compileArgs, { cwd: probeRoot, stdio: "inherit" })
    if (compiled.error !== undefined) throw compiled.error
    if (compiled.status !== 0) {
      throw new Error(`bun ${compileArgs.join(" ")} failed with exit code ${compiled.status ?? 1}`)
    }
    const probed = spawnSync(probeBinary, [], { encoding: "utf8" })
    if (probed.status !== 0) {
      throw new Error(`embedded payload probe failed: ${probed.stderr}`)
    }
    const parsed = JSON.parse(probed.stdout) as {
      names: string[]
      manifest: RuntimeManifest | null
    }
    if (parsed.manifest === null) {
      throw new Error(
        `embedded payload probe found no runtime manifest (${parsed.names.length} files embedded). The bun on PATH likely predates directory --asset support, which is accepted silently and dropped - resolve a bun >= 1.4 and retry.`,
      )
    }
    const relPaths = parsed.names
      .map((name) => relPathForEmbeddedName(name))
      .filter((relPath): relPath is string => relPath !== undefined)
    return { names: parsed.names, relPaths, manifest: parsed.manifest }
  } finally {
    removeProbeRoot(probeRoot)
  }
}
