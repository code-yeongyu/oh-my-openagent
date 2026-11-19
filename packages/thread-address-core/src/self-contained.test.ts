import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseSync } from "oxc-parser"

// Package contract: omo-desktop-app vendors these files byte-for-byte and loads them in its web client, and
// remote/seams.ts (the published omo-ai/remote types) reaches parse.ts. So no source file may import anything but a
// sibling file of this package: no dependency, no node: built-in, no Bun module.
const SRC = new URL(".", import.meta.url).pathname

function specifiers(file: string): string[] {
  const found: string[] = []
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return
    if (Array.isArray(node)) return node.forEach(visit)
    const type = Reflect.get(node, "type")
    if (type === "ImportDeclaration" || type === "ExportAllDeclaration" || type === "ExportNamedDeclaration" || type === "ImportExpression") {
      const source: unknown = Reflect.get(node, "source")
      const value = typeof source === "object" && source !== null ? Reflect.get(source, "value") : undefined
      if (typeof value === "string") found.push(value)
    }
    for (const value of Object.values(node)) visit(value)
  }
  visit(parseSync(file, readFileSync(file, "utf8")).program)
  return found
}

describe("#given the package's source files #when their imports are read #then each imports only sibling files", () => {
  const sources = readdirSync(SRC).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))

  test("#given the walker #when it reads a file with imports #then it sees them, so an empty result is not a blind walker", () => {
    expect(specifiers(join(SRC, "device.ts"))).toContain("./parse")
  })

  test.each(sources)("%s", (name) => {
    const outside = specifiers(join(SRC, name)).filter((specifier) => !/^\.\/[a-z-]+$/.test(specifier))
    expect(outside).toEqual([])
  })
})
