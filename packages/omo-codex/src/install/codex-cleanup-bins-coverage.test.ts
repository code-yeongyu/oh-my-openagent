/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFile, readdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { MANAGED_CODEX_BIN_NAMES } from "./codex-cleanup-bins"

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "plugin")

describe("managed Codex bin coverage", () => {
  test("#given every plugin component package bin #when uninstall coverage is checked #then each name is a managed bin name", async () => {
    // given
    const declaredBinNames = await collectDeclaredBinNames(pluginRoot)

    // then: a component adding a bin without listing it here would survive uninstall
    expect(declaredBinNames.length).toBeGreaterThan(0)
    const uncovered = declaredBinNames.filter((name) => !MANAGED_CODEX_BIN_NAMES.has(name))
    expect(uncovered).toEqual([])
  })
})

async function collectDeclaredBinNames(root: string): Promise<readonly string[]> {
  const names = new Set<string>()
  await walk(root, names)
  return [...names].sort()
}

async function walk(directory: string, names: Set<string>): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => null)
  if (entries === null) return

  if (entries.some((entry) => entry.isFile() && entry.name === "package.json")) {
    for (const name of await readBinNames(join(directory, "package.json"))) names.add(name)
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue
    await walk(join(directory, entry.name), names)
  }
}

async function readBinNames(packageJsonPath: string): Promise<readonly string[]> {
  const parsed: unknown = JSON.parse(await readFile(packageJsonPath, "utf8"))
  if (typeof parsed !== "object" || parsed === null) return []
  const record = parsed as { readonly name?: unknown; readonly bin?: unknown }
  if (typeof record.bin === "string") return typeof record.name === "string" ? [basenameOf(record.name)] : []
  if (typeof record.bin !== "object" || record.bin === null) return []
  return Object.keys(record.bin as Record<string, unknown>)
}

function basenameOf(packageName: string): string {
  const segments = packageName.split("/")
  return segments[segments.length - 1] ?? packageName
}
