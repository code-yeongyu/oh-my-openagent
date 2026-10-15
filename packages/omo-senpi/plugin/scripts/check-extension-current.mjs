import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { artifactsMatch } from "./build-artifact.mjs"
import { buildExtension, COMPUTER_PRELUDE_ASSET_NAME, extensionBuildPaths, resolveOutputs } from "./build-extension-core.mjs"
import { checkTrackedOutputs } from "./check-tracked-outputs.mjs"
import { findStaleRuntimePersona, runtimePersonaSources } from "./persona-artifacts.mjs"

export async function checkExtensionCurrent(options = {}) {
  // The builder owns the inventory. A hand-maintained second list missed the gateway rules sidecar.
  const outputs = resolveOutputs(options)
  const { output } = outputs
  const current = new Map()
  for (const [name, outputFile] of Object.entries(outputs)) {
    const contents = await readBuiltEntry(outputFile)
    if (contents === undefined) return { ok: false, reason: "missing-output", output: outputFile }
    current.set(name, contents)
  }

  // Explicitly redirected builds can live outside Git. Only the canonical checkout promises tracked outputs.
  const defaults = resolveOutputs({})
  if (process.env.OMO_SENPI_PLUGIN_OUTPUT === undefined && Object.entries(outputs).every(([name, path]) => path === defaults[name])) {
    const tracked = checkTrackedOutputs(extensionBuildPaths.repoRoot, [
      ...Object.values(outputs),
      join(dirname(output), COMPUTER_PRELUDE_ASSET_NAME),
      ...runtimePersonaSources(extensionBuildPaths.repoRoot).map(([name]) => join(dirname(output), name)),
    ])
    if (tracked !== undefined) return tracked
  }

  const tempRoot = await mkdtemp(join(tmpdir(), "omo-senpi-build-check-"))
  const expected = resolveOutputs({ outputPath: join(tempRoot, "omo.js") })
  try {
    await buildExtension(Object.fromEntries(Object.entries(expected).map(([name, path]) => [`${name}Path`, path])))
    for (const [name, outputFile] of Object.entries(outputs)) {
      if (!artifactsMatch(current.get(name), await readFile(expected[name], "utf8"))) {
        return { ok: false, reason: "stale-output", output: outputFile }
      }
    }
    const stalePersona = await findStaleRuntimePersona(tempRoot, dirname(output), extensionBuildPaths.repoRoot)
    if (stalePersona !== undefined) return { ok: false, reason: "stale-output", output: stalePersona }
    const expectedPrelude = await readFile(join(tempRoot, COMPUTER_PRELUDE_ASSET_NAME), "utf8")
    const currentPrelude = await readFile(join(dirname(output), COMPUTER_PRELUDE_ASSET_NAME), "utf8").catch(() => undefined)
    if (currentPrelude !== expectedPrelude) {
      return { ok: false, reason: "stale-output", output: join(dirname(output), COMPUTER_PRELUDE_ASSET_NAME) }
    }
    return { ok: true, ...outputs }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

function isErrno(error, code) {
  return error instanceof Error && "code" in error && error.code === code
}

async function readBuiltEntry(output) {
  try {
    return await readFile(output, "utf8")
  } catch (error) {
    if (isErrno(error, "ENOENT")) return undefined
    throw error
  }
}
