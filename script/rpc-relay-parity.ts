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

const WRAPPERS: ReadonlySet<string> = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "ParenthesizedExpression",
])

/** `node` with type assertions and parentheses removed (`("m" as const)` is the literal `"m"`). */
const unwrap = (node: unknown): unknown => (isNode(node) && WRAPPERS.has(node.type) ? unwrap(node["expression"]) : node)

/** The string `value` as a literal: a quoted string or a template literal with no substitutions (`` `m` ``). */
const isLiteral = (node: unknown, value: string): boolean => {
  const bare = unwrap(node)
  if (!isNode(bare)) return false
  if (bare.type === "Literal") return bare["value"] === value
  const [quasi] = Array.isArray(bare["quasis"]) ? bare["quasis"] : []
  const cooked = isNode(quasi) ? Reflect.get(Object(quasi["value"]), "cooked") : undefined
  return (
    bare.type === "TemplateLiteral" &&
    Array.isArray(bare["expressions"]) &&
    bare["expressions"].length === 0 &&
    cooked === value
  )
}

/** `x.type`, `x["type"]` or their optional-chain forms (not `x.$type`, not `x.typeName`). */
const isTypeMember = (value: unknown): boolean => {
  const node = unwrap(value)
  if (isNode(node) && node.type === "ChainExpression") return isTypeMember(node["expression"])
  return (
    isNode(node) &&
    node.type === "MemberExpression" &&
    (node["computed"] === true
      ? isLiteral(node["property"], "type")
      : isNode(node["property"]) && node["property"]["name"] === "type")
  )
}

/** The identifier a `type` member is read from: `e` for `e.type`, `e?.type` or `(e as Frame).type`. */
const memberObjectName = (value: unknown): unknown => {
  const node = unwrap(value)
  if (isNode(node) && node.type === "ChainExpression") return memberObjectName(node["expression"])
  const object = isNode(node) && node.type === "MemberExpression" ? unwrap(node["object"]) : undefined
  return isNode(object) && object.type === "Identifier" ? object["name"] : undefined
}

/**
 * `list.map((e) => e.type)`: the `type` member of the callback's own first parameter, from an expression body or a
 * block that only returns it (an arrow or a function expression). `list.map((e) => other.type)` and a computed
 * `list[map](...)` do not count.
 */
const isTypeProjection = (value: unknown): boolean => {
  const node = unwrap(value)
  if (!isNode(node) || node.type !== "CallExpression" || !isNode(node["callee"])) return false
  const callee = node["callee"]
  const [fn] = Array.isArray(node["arguments"]) ? node["arguments"] : []
  if (callee.type !== "MemberExpression" || callee["computed"] === true || !isNode(callee["property"])) return false
  if (callee["property"]["name"] !== "map") return false
  if (!isNode(fn) || (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression")) return false
  const [param] = Array.isArray(fn["params"]) ? fn["params"] : []
  if (!isNode(param) || param.type !== "Identifier") return false
  const ownType = (expr: unknown): boolean => isTypeMember(expr) && memberObjectName(expr) === param["name"]
  const body = fn["body"]
  if (ownType(body)) return true
  const statements = isNode(body) && Array.isArray(body["body"]) ? body["body"] : []
  const [only] = statements
  return statements.length === 1 && isNode(only) && only.type === "ReturnStatement" && ownType(only["argument"])
}

const EXPECT_MATCHERS: ReadonlySet<string> = new Set(["toBe", "toEqual", "toStrictEqual"])
const ASSERT_METHODS: ReadonlySet<string> = new Set(["equal", "strictEqual"])

/**
 * `expect(<type member>).toBe("m")` (or toEqual/toStrictEqual), `expect(<list>.map((e) => e.type)).toEqual(["m"])`
 * (or toStrictEqual; never toBe, which cannot pass on a fresh array), or `assert.equal(<type member>, "m")` (or
 * strictEqual, either argument order).
 */
function assertsRecordType(node: AstNode, method: string): boolean {
  const callee = node["callee"]
  const args = Array.isArray(node["arguments"]) ? node["arguments"] : []
  if (!isNode(callee) || callee.type !== "MemberExpression" || !isNode(callee["property"])) return false
  const name = String(callee["property"]["name"])
  const subject = callee["object"]
  if (isNode(subject) && subject.type === "Identifier" && subject["name"] === "assert" && ASSERT_METHODS.has(name)) {
    const [a, b] = args
    return (isTypeMember(a) && isLiteral(b, method)) || (isTypeMember(b) && isLiteral(a, method))
  }
  if (!EXPECT_MATCHERS.has(name) || !isNode(subject) || subject.type !== "CallExpression") return false
  const expectCallee = subject["callee"]
  if (!isNode(expectCallee) || expectCallee["name"] !== "expect" || !Array.isArray(subject["arguments"])) return false
  const [actual] = subject["arguments"]
  const [expected] = args
  if (isTypeMember(actual)) return isLiteral(expected, method)
  const items = isNode(expected) && expected.type === "ArrayExpression" ? expected["elements"] : undefined
  return (
    name !== "toBe" && isTypeProjection(actual) && Array.isArray(items) && items.some((item) => isLiteral(item, method))
  )
}

/** Whether one AST node uses `method` as a record type (see namesRecordType). */
function usesRecordType(node: AstNode, method: string): boolean {
  if (node.type === "Property") {
    const key = node["key"]
    // A computed key `{ [type]: "m" }` names whatever the variable holds, not the `type` field.
    const named =
      isNode(key) &&
      (node["computed"] === true ? isLiteral(key, "type") : key["name"] === "type" || key["value"] === "type")
    return named && isLiteral(node["value"], method)
  }
  if (node.type === "SwitchStatement" && isTypeMember(node["discriminant"])) {
    const cases = node["cases"]
    return Array.isArray(cases) && cases.some((c) => isNode(c) && isLiteral(c["test"], method))
  }
  // Only equality counts: `x.type !== "m"` (as in `filter((f) => f.type !== "m")`) excludes the method (as `.not.toBe`
  // does).
  if (node.type === "BinaryExpression" && ["===", "=="].includes(String(node["operator"]))) {
    const [left, right] = [node["left"], node["right"]]
    return (isTypeMember(left) && isLiteral(right, method)) || (isTypeMember(right) && isLiteral(left, method))
  }
  if (node.type === "CallExpression") return assertsRecordType(node, method)
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
 * Whether `source` (parsed as TypeScript) uses `method` as a record type in code. These count:
 * - the quoted name as the value of a `type` property in an object (`{ type: "m" }`, also `{ ["type"]: "m" }`);
 * - a `type` member (`x.type`, `x["type"]`, optional chains) compared equal with it (`===`, `==`), or switched on with
 *   a `case "m":`;
 * - an assertion on a `type` member: `expect(x.type).toBe("m")` (or `toEqual`, `toStrictEqual`),
 *   `expect(list.map((e) => e.type)).toEqual(["m"])` (or `toStrictEqual`; the callback's own parameter, an expression
 *   or single-return block body), or `assert.equal(x.type, "m")` (or `strictEqual`, either argument order).
 * The literal may be a quoted string or a template literal with no substitutions. A literal, a `type` member and a
 * switch discriminant may each sit in parentheses or under `as`, `satisfies`, a non-null `!` or a `<T>` assertion.
 * These do not count: a computed key (`{ [type]: "m" }`), a negative comparison (`!==`, `!=`, such as an exclusion
 * `filter((f) => f.type !== "m")`), an assertion whose subject is not a bare `expect(...)` or whose object is not
 * `assert`, a mapped list that projects anything but the callback parameter's `type`, a computed `list[map](...)`,
 * `.toBe([...])` on a mapped list, comments, strings (a test title), regex literals, type declarations, other
 * properties such as `$type`, and a source that does not parse.
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
