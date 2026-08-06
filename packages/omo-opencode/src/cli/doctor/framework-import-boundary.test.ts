/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const doctorDir = dirname(fileURLToPath(import.meta.url))
const frameworkDir = join(doctorDir, "framework")
const importPattern = /\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g

function listTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(dir, entry.name)
    if (entry.isDirectory()) return listTypeScriptFiles(entryPath)
    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : []
  })
}

describe("doctor framework import boundary", () => {
  test("#given doctor framework files #when auditing imports #then framework never imports checks", () => {
    //#given
    expect(existsSync(frameworkDir)).toBe(true)
    const frameworkFiles = listTypeScriptFiles(frameworkDir)
    expect(frameworkFiles.length).toBeGreaterThan(0)

    //#when
    const forbiddenImports = frameworkFiles.flatMap((filePath) => {
      const source = readFileSync(filePath, "utf-8")
      return Array.from(source.matchAll(importPattern))
        .map((match) => match[1])
        .filter((specifier): specifier is string => specifier !== undefined)
        .filter((specifier) => specifier.includes("/checks") || specifier.includes("../checks"))
        .map((specifier) => `${relative(doctorDir, filePath)} -> ${specifier}`)
    })

    //#then
    expect(forbiddenImports).toEqual([])
  })
})
