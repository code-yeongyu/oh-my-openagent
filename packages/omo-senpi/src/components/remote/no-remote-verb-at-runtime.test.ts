// Architecture contract G4 (design one-remote-module v8-core r2, B4; omo#13414): nothing in omo-senpi starts a person's
// `omo remote <verb>` at runtime. A spawn argv that begins with "remote" (an array literal, also through a constant) in a
// file that starts processes from OMO_BIN or process.execPath fails here. The one exception is the TUI's /remote command
// (components/remote/tui/command.ts, PR 5), which runs the CLI as the person at that terminal.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { parseSync } from "oxc-parser"

const SRC = join(import.meta.dir, "..", "..")
const EXCEPTIONS = new Set(["components/remote/tui/command.ts"])
const EXEMPT = /(\.test\.ts$|\/test\/|\/testing\/)/

type Node = { readonly type: string; readonly [key: string]: unknown }

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string"

function* walk(node: unknown): Generator<Node> {
  if (Array.isArray(node)) {
    for (const item of node) yield* walk(item)
    return
  }
  if (!isNode(node)) return
  yield node
  for (const [key, value] of Object.entries(node)) if (key !== "parent") yield* walk(value)
}

const startsWithRemote = (node: Node): boolean => {
  if (node.type !== "ArrayExpression") return false
  const first = (node["elements"] as unknown[] | undefined)?.[0]
  return isNode(first) && first.type === "Literal" && first["value"] === "remote"
}

function remoteVerbArgvs(path: string, source: string): string[] {
  if (!/\bOMO_BIN\b|process\.execPath/.test(source)) return []
  const { program } = parseSync(path, source)
  const found: string[] = []
  for (const node of walk(program))
    if (startsWithRemote(node)) found.push(source.slice(node["start"] as number, node["end"] as number))
  return found
}

describe("no `omo remote` verb at runtime (G4)", () => {
  test("#given omo-senpi's sources #when every spawn argv is scanned #then none starts with the remote verb", async () => {
    const files = [...new Bun.Glob("**/*.ts").scanSync({ cwd: SRC })].filter(
      (file) => !EXEMPT.test(`/${file}`) && !EXCEPTIONS.has(file),
    )
    expect(files).toContain("components/device-service/runner.ts")
    const offenders = files.flatMap((file) =>
      remoteVerbArgvs(file, readFileSync(join(SRC, file), "utf8")).map(
        (argv) => `${relative(SRC, join(SRC, file))}: ${argv}`,
      ),
    )
    expect(offenders).toEqual([])
  })

  test("#given the bootstrap runner's old argv #when it is scanned #then it is reported", () => {
    const old =
      'const BOOTSTRAP_ARGS = ["remote", "bootstrap", "--json"] as const\nspawn(process.env.OMO_BIN ?? "", [...BOOTSTRAP_ARGS])\n'
    expect(remoteVerbArgvs("runner.ts", old)).toEqual(['["remote", "bootstrap", "--json"]'])
  })
})
