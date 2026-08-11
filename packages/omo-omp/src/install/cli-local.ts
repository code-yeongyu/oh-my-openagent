#!/usr/bin/env bun
// @bun
// Bundled by build-install.mjs to plugin/scripts/install.mjs — the OMP plugin-package
// install hook. The OMP plugin manager may invoke it with "install" | "uninstall".

import { existsSync as fileExistsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { runOmpInstaller, runOmpUninstaller, OMO_OMP_PACKAGE_NAME } from "./install-omp"

async function main(argv: readonly string[]): Promise<number> {
  const action = argv[2]
  const packagedPluginPath = resolvePackagedPluginPath(import.meta.url)
  const options = packagedPluginPath === undefined ? {} : { pluginPath: packagedPluginPath }
  try {
    if (action === "install") {
      printJson(await runOmpInstaller(options))
      return 0
    }
    if (action === "uninstall") {
      printJson(await runOmpUninstaller(options))
      return 0
    }
    throw new Error("Expected positional action install|uninstall")
  } catch (error) {
    printJson({ ok: false, error: error instanceof Error ? error.message : String(error) })
    return 1
  }
}

function printJson(result: unknown): void {
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

function resolvePackagedPluginPath(importerUrl: string): string | undefined {
  const scriptDir = dirname(fileURLToPath(importerUrl))
  const candidate = resolve(scriptDir, "..")
  const manifestPath = join(candidate, "package.json")
  if (!fileExistsSync(manifestPath)) return undefined
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"))
  if (!isRecord(parsed) || parsed.name !== OMO_OMP_PACKAGE_NAME) return undefined
  if (!fileExistsSync(join(candidate, "extensions", "omo.js"))) return undefined
  return candidate
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

process.exit(await main(process.argv))
