#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { runSenpiInstaller, runSenpiUninstaller } from "./install-senpi"

type JsonResult =
  | Awaited<ReturnType<typeof runSenpiInstaller>>
  | Awaited<ReturnType<typeof runSenpiUninstaller>>
  | { readonly ok: false; readonly error: string }

async function main(argv: readonly string[]): Promise<number> {
  const action = argv[2]
  const packagedPluginPath = resolvePackagedPluginPath(import.meta.url)
  try {
    if (action === "install") {
      printJson(await runSenpiInstaller(packagedPluginPath === undefined ? {} : { pluginPath: packagedPluginPath }))
      return 0
    }
    if (action === "uninstall") {
      printJson(await runSenpiUninstaller(packagedPluginPath === undefined ? {} : { pluginPath: packagedPluginPath }))
      return 0
    }
    throw new Error("Expected positional action install|uninstall")
  } catch (error) {
    printJson({ ok: false, error: error instanceof Error ? error.message : String(error) })
    return 1
  }
}

function printJson(result: JsonResult): void {
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

function resolvePackagedPluginPath(importerUrl: string): string | undefined {
  const scriptDir = dirname(fileURLToPath(importerUrl))
  const candidate = resolve(scriptDir, "..")
  const manifestPath = join(candidate, "package.json")
  if (!existsSync(manifestPath)) return undefined
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"))
  if (!isRecord(parsed) || parsed.name !== "@code-yeongyu/omo-senpi") return undefined
  if (!existsSync(join(candidate, "extensions", "omo.js"))) return undefined
  return candidate
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

process.exit(await main(process.argv))
