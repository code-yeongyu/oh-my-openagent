// Generates docs/reference/rpc-relay-parity.md from the pinned engine's own RPC method table (senpi#4319), so a
// method the engine adds appears in the table without a hand edit (#13478).
// The engine package does not export its method table, so the table is imported BY FILE from the resolved package
// (dist/modes/rpc/method-classes.js): if the engine moves that file, this script and its test fail here first.
// Pair tests declare the methods they cover in tracked `*.pair.ts` files (pairTest, #13961); this script reads only those
// declarations. It also writes the method list a declaration's `covers` is typed against (RPC_METHODS_PATH).
// Run: bun script/rpc-relay-parity.ts          writes the table and the method list
//      bun script/rpc-relay-parity.ts --check  exits 1 when either is stale or a declaration is broken
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

interface MethodClasses {
  readonly version: number
  readonly digest: string
  readonly classes: Readonly<Record<string, string>>
}

interface CuratedRow {
  readonly relay?: string
}

/** A pair test as its `*.pair.ts` file declares it (packages/omo-senpi/src/components/thread/testing/pair-test.ts). */
export interface PairDeclaration {
  readonly file: string
  readonly test: string
  readonly covers: readonly string[]
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
export const TABLE_PATH = join(root, "docs/reference/rpc-relay-parity.md")
export const RPC_METHODS_PATH = join(root, "packages/omo-senpi/src/components/thread/testing/rpc-methods.generated.ts")
const ROWS_PATH = join(root, "script/rpc-relay-parity.rows.json")
const engineDist = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
const engineVersion: string = JSON.parse(readFileSync(join(engineDist, "../package.json"), "utf8")).version

export async function engineMethodClasses(): Promise<MethodClasses> {
  const table = (await import(join(engineDist, "modes/rpc/method-classes.js"))) as {
    describeRpcMethodClasses: () => MethodClasses
  }
  return table.describeRpcMethodClasses()
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function parseRow(path: string, method: string, row: unknown): CuratedRow {
  if (!isRecord(row)) throw new Error(`${path}: the row for ${method} is not an object`)
  for (const [key, value] of Object.entries(row)) {
    if (key !== "relay") throw new Error(`${path}: ${method} has unknown key "${key}" (allowed: relay)`)
    if (typeof value !== "string") throw new Error(`${path}: ${method}.${key} is not a string`)
  }
  return typeof row.relay === "string" ? { relay: row.relay } : {}
}

export function curatedRows(path: string = ROWS_PATH): Readonly<Record<string, CuratedRow>> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (!isRecord(parsed)) throw new Error(`${path}: expected an object of method rows`)
  return Object.fromEntries(Object.entries(parsed).map(([method, row]) => [method, parseRow(path, method, row)]))
}

const isPairTest = (value: unknown): value is { readonly test: string; readonly covers: readonly string[] } =>
  isRecord(value) &&
  typeof value["test"] === "string" &&
  Array.isArray(value["covers"]) &&
  value["covers"].every((method) => typeof method === "string")

/** Every pair-test declaration: each export of a tracked `*.pair.ts` file that is a pair test (`test` and `covers`). */
export async function pairDeclarations(): Promise<PairDeclaration[]> {
  const listed = Bun.spawnSync(["git", "ls-files", "-z", "--", "*.pair.ts"], { cwd: root })
  if (listed.exitCode !== 0) throw new Error(`git ls-files failed: ${listed.stderr.toString()}`)
  const files = listed.stdout.toString().split("\0").filter(Boolean)
  const found = await Promise.all(
    files.map(async (file) => {
      const exported: Record<string, unknown> = await import(join(root, file))
      return Object.values(exported).flatMap((value) =>
        isPairTest(value) ? [{ file, test: value.test, covers: value.covers }] : [],
      )
    }),
  )
  return found.flat()
}

/** A declaration must name a test file in this repository and only methods of the pinned engine's table. */
export function pairTestProblems(
  declarations: readonly PairDeclaration[],
  classes: Readonly<Record<string, string>>,
): string[] {
  return declarations.flatMap((declaration) => [
    ...(existsSync(join(root, declaration.test))
      ? []
      : [`${declaration.file}: pair test ${declaration.test} does not exist`]),
    ...declaration.covers
      .filter((method) => !(method in classes))
      .map((method) => `${declaration.file}: ${method} is not a method of the engine's table`),
  ])
}

/** The pair tests that declare each method, for the table's pair-test column. */
export function pairTestsByMethod(declarations: readonly PairDeclaration[]): Readonly<Record<string, string>> {
  const byMethod: Record<string, string[]> = {}
  for (const declaration of declarations)
    for (const method of declaration.covers) (byMethod[method] ??= []).push(declaration.test)
  return Object.fromEntries(Object.entries(byMethod).map(([method, tests]) => [method, tests.join(", ")]))
}

/** The method list a pair test's `covers` is typed against, one literal per engine method, in the table's order. */
export function renderRpcMethods(methods: MethodClasses): string {
  return `// GENERATED by script/rpc-relay-parity.ts from the pinned engine's method table. Do not edit by hand: run
// \`bun script/rpc-relay-parity.ts\`. A pair test's \`covers\` (pair-test.ts) is typed against this list.
export type RpcMethod =
${Object.keys(methods.classes)
  .map((name) => `  | "${name}"`)
  .join("\n")}
`
}

/** What `--check` fails on: a committed table or method list that differs from the rendered one. */
export function staleProblems(
  committed: { readonly table: string; readonly methods: string },
  rendered: { readonly table: string; readonly methods: string },
): string[] {
  return [
    ...(committed.table === rendered.table ? [] : [`${TABLE_PATH} is stale; run: bun script/rpc-relay-parity.ts`]),
    ...(committed.methods === rendered.methods
      ? []
      : [`${RPC_METHODS_PATH} is stale; run: bun script/rpc-relay-parity.ts`]),
  ]
}

// The engine's own definition of connection_local: it configures the sender's own connection, so it is never
// permitted on someone else's behalf and has no relay counterpart.
const CONNECTION_LOCAL_EXCLUSION = "excluded: connection_local (only the sending connection's own)"

export function renderTable(
  methods: MethodClasses,
  rows: Readonly<Record<string, CuratedRow>>,
  pairs: Readonly<Record<string, string>>,
): string {
  const names = Object.keys(methods.classes)
  const relayOf = (name: string): string =>
    rows[name]?.relay ?? (methods.classes[name] === "connection_local" ? CONNECTION_LOCAL_EXCLUSION : "not verified")
  const lines = names.map(
    (name) =>
      `| \`${name}\` | ${methods.classes[name]} | served (not measured) | ${relayOf(name)} | ${pairs[name] ?? "none"} |`,
  )
  const tested = names.filter((name) => pairs[name] !== undefined).length
  const excluded = names.filter((name) => relayOf(name).startsWith("excluded")).length
  return `# Engine RPC methods: local versus relay parity

<!-- GENERATED by script/rpc-relay-parity.ts from the pinned engine's method table. Do not edit by hand:
record a relay verdict in script/rpc-relay-parity.rows.json or a pair test in a \`*.pair.ts\` declaration, then run
\`bun script/rpc-relay-parity.ts\`. -->

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
- **Pair test**: the test that declares the method in its \`*.pair.ts\` file (\`pairTest\`, #13961) and proves it is
  sent on both the local and the relay leg, or \`none\`.

${names.length} methods: ${tested} with a pair test, ${excluded} excluded, ${names.length - tested - excluded} with neither.

| Method | Engine class | Local | Through the relay | Pair test |
| --- | --- | --- | --- | --- |
${lines.join("\n")}
`
}

if (import.meta.main) {
  const methods = await engineMethodClasses()
  const declarations = await pairDeclarations()
  const rendered = {
    table: renderTable(methods, curatedRows(), pairTestsByMethod(declarations)),
    methods: renderRpcMethods(methods),
  }
  const check = process.argv.includes("--check")
  const committed = check
    ? { table: readFileSync(TABLE_PATH, "utf8"), methods: readFileSync(RPC_METHODS_PATH, "utf8") }
    : undefined
  const problems = [
    ...(committed === undefined ? [] : staleProblems(committed, rendered)),
    ...pairTestProblems(declarations, methods.classes),
  ]
  for (const problem of problems) console.error(problem)
  if (problems.length > 0) process.exit(1)
  if (!check) {
    writeFileSync(TABLE_PATH, rendered.table)
    writeFileSync(RPC_METHODS_PATH, rendered.methods)
  }
}
