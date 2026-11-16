import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { parseSync } from "oxc-parser"

// Package contract (the omo-ai/remote SDK's published declarations): the remote module's public types - types.ts,
// seams.ts and codes.ts - reach only each other, the thread taxonomy's codes, and leaf files that import nothing outside
// the same set (the local API's protocol vocabulary, its error class, the account-state row, the alias port). Anything
// else in their import closure ships as a private declaration with bare imports of unpublished packages, so a consumer
// of the published types cannot compile them. Every import, `import type`, `export from` and `import()` type is followed.

const repoRoot = resolve(import.meta.dir, "../../../../..")
const at = (path: string) => join(repoRoot, path)
const REMOTE = "packages/omo-senpi/src/components/remote"
const DSC = "packages/device-service-core"
const ROOTS = [`${REMOTE}/types.ts`, `${REMOTE}/seams.ts`, `${REMOTE}/codes.ts`]
const ALLOWED = new Set([
  ...ROOTS,
  "packages/omo-senpi/src/components/thread/errors.ts",
  // The one list of approval modes (dev #13748): a leaf that imports nothing.
  "packages/omo-senpi/src/components/thread/contracts/permission-presets.ts",
  // The alias port (AliasRegistry and its result types): a leaf that imports nothing; ports.ts re-exports it.
  "packages/omo-senpi/src/components/thread/remote/alias-port.ts",
  "packages/omo-senpi/src/components/thread/remote/ports.ts",
  `${DSC}/src/account-state.ts`,
  // The local API wire vocabulary outside local-api/ (guard G1 S1): re-exports of the leaf files below, nothing else.
  `${DSC}/src/wire.ts`,
  `${DSC}/src/local-api/errors.ts`,
  `${DSC}/src/local-api/vocabulary.ts`,
])
const LEAF_PROTOCOL = new RegExp(`^${DSC}/src/local-api/protocol(?:-[a-z]+)?\\.ts$`)
const allowed = (file: string) => ALLOWED.has(file) || LEAF_PROTOCOL.test(file)

const DSC_NAME = "@oh-my-opencode/device-service-core"
const dscExports = JSON.parse(readFileSync(at(`${DSC}/package.json`), "utf8")).exports as Record<string, string>

function specifiersOf(file: string): string[] {
  const found: string[] = []
  const literal = (node: unknown) => {
    const value: unknown = typeof node === "object" && node !== null ? Reflect.get(node, "value") : undefined
    if (typeof value === "string") found.push(value)
  }
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    const type = Reflect.get(node, "type")
    if (
      type === "ImportDeclaration" ||
      type === "ExportNamedDeclaration" ||
      type === "ExportAllDeclaration" ||
      type === "ImportExpression"
    )
      literal(Reflect.get(node, "source"))
    if (type === "TSImportType") {
      const argument: unknown = Reflect.get(node, "argument")
      literal(
        typeof argument === "object" && argument !== null ? (Reflect.get(argument, "literal") ?? argument) : argument,
      )
    }
    for (const value of Object.values(node)) visit(value)
  }
  visit(parseSync(file, readFileSync(at(file), "utf8")).program)
  return found
}

const asFile = (absolute: string): string | undefined =>
  [`${absolute}.ts`, join(absolute, "index.ts"), absolute].find((candidate) => existsSync(candidate))

// A relative path, or a device-service-core subpath through its exports map; any other bare specifier is reached as-is.
function resolveFrom(file: string, specifier: string): string {
  const absolute = specifier.startsWith(".")
    ? asFile(resolve(dirname(at(file)), specifier))
    : specifier === DSC_NAME || specifier.startsWith(`${DSC_NAME}/`)
      ? (() => {
          const target = dscExports[`.${specifier.slice(DSC_NAME.length)}`]
          return target === undefined ? undefined : asFile(resolve(at(DSC), target))
        })()
      : undefined
  if (absolute === undefined) return `bare:${specifier}`
  return relative(repoRoot, absolute).replaceAll("\\", "/")
}

function closureOf(roots: readonly string[]): string[] {
  const seen = new Set<string>()
  const queue = [...roots]
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue
    seen.add(file)
    if (!file.endsWith(".ts")) continue
    for (const specifier of specifiersOf(file)) queue.push(resolveFrom(file, specifier))
  }
  return [...seen].sort()
}

describe("the remote public types' import closure", () => {
  test("#given types.ts, seams.ts and codes.ts #when every import they reach is followed #then only the allowed leaf files are reached", () => {
    // given: the walker sees a known chain, so an empty result below is not a blind walker
    expect(closureOf([`${DSC}/src/local-api/errors.ts`])).toContain(`${DSC}/src/local-api/vocabulary.ts`)
    expect(closureOf([`${DSC}/src/device-service.ts`])).toContain(`${DSC}/src/remote-attach.ts`)

    // when
    const reached = closureOf(ROOTS)

    // then
    expect(reached).toEqual(expect.arrayContaining(ROOTS))
    expect(reached.filter((file) => !allowed(file))).toEqual([])
  })
})
