// Generates docs/reference/rpc-relay-parity.md from the pinned engine's own RPC method table (senpi#4319), so a
// method the engine adds appears in the table without a hand edit (#13478).
// The engine package does not export its method table, so the table is imported BY FILE from the resolved package
// (dist/modes/rpc/method-classes.js): if the engine moves that file, this script and its test fail here first.
// Run: bun script/rpc-relay-parity.ts          writes the table
//      bun script/rpc-relay-parity.ts --check  exits 1 when the committed table is stale
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseSync } from "oxc-parser"

interface MethodClasses {
  readonly version: number
  readonly digest: string
  readonly classes: Readonly<Record<string, string>>
}

interface CuratedRow {
  readonly relay?: string
  readonly test?: string
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
export const TABLE_PATH = join(root, "docs/reference/rpc-relay-parity.md")
const ROWS_PATH = join(root, "script/rpc-relay-parity.rows.json")
const engineDist = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
const engineVersion: string = JSON.parse(readFileSync(join(engineDist, "../package.json"), "utf8")).version

export async function engineMethodClasses(): Promise<MethodClasses> {
  const table = (await import(join(engineDist, "modes/rpc/method-classes.js"))) as {
    describeRpcMethodClasses: () => MethodClasses
  }
  return table.describeRpcMethodClasses()
}

const ROW_KEYS: ReadonlySet<string> = new Set(["relay", "test"])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function parseRow(path: string, method: string, row: unknown): CuratedRow {
  if (!isRecord(row)) throw new Error(`${path}: the row for ${method} is not an object`)
  for (const [key, value] of Object.entries(row)) {
    if (!ROW_KEYS.has(key)) throw new Error(`${path}: ${method} has unknown key "${key}" (allowed: relay, test)`)
    if (typeof value !== "string") throw new Error(`${path}: ${method}.${key} is not a string`)
  }
  return {
    ...(typeof row.relay === "string" && { relay: row.relay }),
    ...(typeof row.test === "string" && { test: row.test }),
  }
}

export function curatedRows(path: string = ROWS_PATH): Readonly<Record<string, CuratedRow>> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (!isRecord(parsed)) throw new Error(`${path}: expected an object of method rows`)
  return Object.fromEntries(Object.entries(parsed).map(([method, row]) => [method, parseRow(path, method, row)]))
}

type AstNode = { readonly type: string; readonly [key: string]: unknown }

const isNode = (value: unknown): value is AstNode =>
  typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string"

const isLiteral = (node: unknown, value: string): boolean =>
  isNode(node) && node.type === "Literal" && node["value"] === value

/** `x.type`, `x["type"]` or their optional-chain forms (not `x.$type`, not `x.typeName`). */
const isTypeMember = (node: unknown): boolean =>
  isNode(node) && node.type === "ChainExpression"
    ? isTypeMember(node["expression"])
    : isNode(node) &&
      node.type === "MemberExpression" &&
      (node["computed"] === true
        ? isLiteral(node["property"], "type")
        : isNode(node["property"]) && node["property"]["name"] === "type")

/** Whether one AST node uses `method` as a record type (see namesRecordType). */
function usesRecordType(node: AstNode, method: string): boolean {
  if (node.type === "Property") {
    const key = node["key"]
    const named = isNode(key) && (key["name"] === "type" || key["value"] === "type")
    return named && isLiteral(node["value"], method)
  }
  if (node.type === "BinaryExpression" && ["===", "=="].includes(String(node["operator"]))) {
    const [left, right] = [node["left"], node["right"]]
    return (isTypeMember(left) && isLiteral(right, method)) || (isTypeMember(right) && isLiteral(left, method))
  }
  if (node.type === "CallExpression" && isNode(node["callee"]) && node["callee"].type === "MemberExpression") {
    const callee = node["callee"]
    const matcher = isNode(callee["property"]) ? callee["property"]["name"] : undefined
    const subject = callee["object"]
    const args = node["arguments"]
    return (
      (matcher === "toBe" || matcher === "toEqual") &&
      Array.isArray(args) &&
      isLiteral(args[0], method) &&
      isNode(subject) &&
      subject.type === "CallExpression" &&
      Array.isArray(subject["arguments"]) &&
      isTypeMember(subject["arguments"][0])
    )
  }
  return false
}

function someNode(value: unknown, test: (node: AstNode) => boolean): boolean {
  if (Array.isArray(value)) return value.some((item) => someNode(item, test))
  if (!isNode(value)) return false
  if (test(value)) return true
  return Object.entries(value).some(
    ([key, child]) => key !== "type" && typeof child === "object" && someNode(child, test),
  )
}

/**
 * Whether `source` (parsed as TypeScript) uses `method` as a record type in code: the quoted name as the value of a `type`
 * property in an object (`{ type: "m" }`), compared with a `type` member (`x.type === "m"`, `x["type"] === "m"`), or
 * asserted on one (`expect(x.type).toBe("m")`). Comments, strings (a test title), regex literals, type declarations,
 * other properties such as `$type`, and a source that does not parse do not count.
 */
export function namesRecordType(source: string, method: string): boolean {
  const parsed = parseSync("pair-test.ts", source)
  return parsed.errors.length === 0 && someNode(parsed.program, (node) => usesRecordType(node, method))
}

/** A curated pair test must be a file in this repository that uses its method as a record type (namesRecordType). */
export function pairTestProblems(rows: Readonly<Record<string, CuratedRow>>): string[] {
  return Object.entries(rows).flatMap(([method, row]) => {
    if (row.test === undefined) return []
    const file = row.test.split(" (")[0] ?? row.test
    const path = join(root, file)
    if (!existsSync(path)) return [`${method}: pair test ${file} does not exist`]
    return namesRecordType(readFileSync(path, "utf8"), method)
      ? []
      : [`${method}: pair test ${file} never uses "${method}" as a record type`]
  })
}

/** What `--check` fails on: a committed table that differs from the rendered one, and every broken pair-test row. */
export function checkProblems(
  committed: string,
  rendered: string,
  rows: Readonly<Record<string, CuratedRow>>,
): string[] {
  return [
    ...(committed === rendered ? [] : [`${TABLE_PATH} is stale; run: bun script/rpc-relay-parity.ts`]),
    ...pairTestProblems(rows),
  ]
}

// The engine's own definition of connection_local: it configures the sender's own connection, so it is never
// permitted on someone else's behalf and has no relay counterpart.
const CONNECTION_LOCAL_EXCLUSION = "excluded: connection_local (only the sending connection's own)"

export function renderTable(methods: MethodClasses, rows: Readonly<Record<string, CuratedRow>>): string {
  const names = Object.keys(methods.classes)
  const relayOf = (name: string): string =>
    rows[name]?.relay ?? (methods.classes[name] === "connection_local" ? CONNECTION_LOCAL_EXCLUSION : "not verified")
  const lines = names.map(
    (name) =>
      `| \`${name}\` | ${methods.classes[name]} | served (not measured) | ${relayOf(name)} | ${rows[name]?.test ?? "none"} |`,
  )
  const tested = names.filter((name) => rows[name]?.test !== undefined).length
  const excluded = names.filter((name) => relayOf(name).startsWith("excluded")).length
  return `# Engine RPC methods: local versus relay parity

<!-- GENERATED by script/rpc-relay-parity.ts from the pinned engine's method table. Do not edit by hand:
record a relay verdict or a pair test in script/rpc-relay-parity.rows.json, then run \`bun script/rpc-relay-parity.ts\`. -->

One row per inbound RPC record type the engine classifies: \`RPC_METHOD_CLASS\` in \`@code-yeongyu/senpi\`
${engineVersion} (\`dist/modes/rpc/method-classes.js\`, read through \`describeRpcMethodClasses()\`; imported by
file because the package does not export it, so an engine that moves the file fails the test here), table version
${methods.version}, digest \`${methods.digest}\`. A method the engine adds, removes or reclassifies changes this
table, and \`script/rpc-relay-parity.test.ts\` fails until it is regenerated (#13478).

- **Engine class**: the engine's own class for the record (\`dynamic\` when the class depends on the record's fields).
- **Local**: served (engine accepts on its own connection; not measured per method). The engine classifies records
  but does not gate its own local connection with the table.
- **Through the relay**: a recorded verdict; \`excluded: connection_local\` for the engine's connection_local class;
  otherwise \`not verified\`.
- **Pair test**: the test that proves the local and relay answers agree, or \`none\`.

${names.length} methods: ${tested} with a pair test, ${excluded} excluded, ${names.length - tested - excluded} with neither.

| Method | Engine class | Local | Through the relay | Pair test |
| --- | --- | --- | --- | --- |
${lines.join("\n")}
`
}

if (import.meta.main) {
  const rows = curatedRows()
  const rendered = renderTable(await engineMethodClasses(), rows)
  const problems = process.argv.includes("--check")
    ? checkProblems(readFileSync(TABLE_PATH, "utf8"), rendered, rows)
    : pairTestProblems(rows)
  for (const problem of problems) console.error(problem)
  if (problems.length > 0) process.exit(1)
  if (!process.argv.includes("--check")) writeFileSync(TABLE_PATH, rendered)
}
