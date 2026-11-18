import { expect, test } from "bun:test"
import { join, sep } from "node:path"

import { parseSync } from "oxc-parser"

import { FLOORED_ROUTE_PREFIX } from "./contract-version"

// Protocol and security contract (#13691): the service's client floor reads the contract headers on every
// `/v1/sync/*` request, so a sync client that builds its own authorization header silently drops them, and
// after phrase genesis the account refuses it 426. Every sync and account client builds its request headers
// with syncRequestHeaders(); this audit parses each client file and fails on any other construction of an
// authorization header or a bearer value.
const REPO = join(import.meta.dir, "../../../..")
const BUILDER = "packages/memory-core/src/sync/contract-version.ts"
const CLIENT_SCOPES = [
  "packages/memory-core/src/sync/**/*.ts",
  "packages/omo-senpi/src/components/memory/**/*.ts",
  "packages/omo-native/*.ts",
  "packages/omo-opencode/src/cli/service-auth/**/*.ts",
  "packages/omo-opencode/src/cli/account-keys/**/*.ts",
]
// Bun.Glob yields native separators (backslashes on Windows); every comparison below is against POSIX paths.
const posixPath = (file: string): string => file.split(sep).join("/")
const AUTHORIZATION = /^authorization$/i
const BEARER = /^bearer\s/i

type Node = { readonly type?: unknown; readonly [key: string]: unknown }
const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null

const nameOf = (key: unknown): string | null => {
  if (!isNode(key)) return null
  if (key.type === "Identifier" && typeof key["name"] === "string") return key["name"]
  if (key.type === "Literal" && typeof key["value"] === "string") return key["value"]
  return null
}

/** Each place `source` sets an authorization header (object key, member write, Headers.set/append) or builds a bearer value. */
function authorizationSites(file: string, source: string): string[] {
  const sites: string[] = []
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!isNode(node)) return
    const at = `${node.type}@${String(node["start"])}`
    if (node.type === "Property" && AUTHORIZATION.test(nameOf(node["key"]) ?? "")) sites.push(at)
    if (node.type === "MemberExpression" && AUTHORIZATION.test(nameOf(node["property"]) ?? "")) sites.push(at)
    if (node.type === "CallExpression" && isNode(node["callee"]) && node["callee"].type === "MemberExpression") {
      const method = nameOf(node["callee"]["property"])
      const first = Array.isArray(node["arguments"]) ? node["arguments"][0] : undefined
      if ((method === "set" || method === "append") && AUTHORIZATION.test(nameOf(first) ?? "")) sites.push(at)
    }
    if (node.type === "Literal" && typeof node["value"] === "string" && BEARER.test(node["value"])) sites.push(at)
    if (node.type === "TemplateElement" && isNode(node["value"]) && BEARER.test(String(node["value"]["cooked"])))
      sites.push(at)
    for (const [key, child] of Object.entries(node)) if (key !== "parent") visit(child)
  }
  visit(parseSync(file, source).program)
  return sites
}

test.each([
  ["an object key", "const h = { authorization: t }"],
  ["a quoted capitalised key", 'const h = { "Authorization": t }'],
  ["a computed key", 'const h = { ["authorization"]: t }'],
  ["a member write", "h.authorization = t"],
  ["a computed member write", 'h["Authorization"] = t'],
  ["Headers.set", 'headers.set("Authorization", t)'],
  ["Headers.append", 'headers.append("authorization", t)'],
  ["a bearer template", "const v = `Bearer ${t}`"],
  ["a bearer concatenation", 'const v = "Bearer " + t'],
])("the audit catches a hand-built authorization header: %s", (_name, source) => {
  expect(authorizationSites("probe.ts", source)).not.toEqual([])
})

test("the audit passes headers built by syncRequestHeaders and code that only mentions authorization in prose", () => {
  const source = '// authorization: Bearer x\nconst h = { ...syncRequestHeaders(t), accept: "text/event-stream" }'
  expect(authorizationSites("probe.ts", source)).toEqual([])
})

test("no sync or account client builds an authorization header except through syncRequestHeaders (#13691)", async () => {
  const files = new Set<string>()
  for (const scope of CLIENT_SCOPES)
    for await (const file of new Bun.Glob(scope).scan({ cwd: REPO })) files.add(posixPath(file))
  // Any other source file that names a floored route is a sync client too, wherever it lives.
  for await (const file of new Bun.Glob("packages/*/src/**/*.ts").scan({ cwd: REPO }))
    if ((await Bun.file(join(REPO, file)).text()).includes(FLOORED_ROUTE_PREFIX)) files.add(posixPath(file))

  const offenders: string[] = []
  for (const file of files) {
    if (file === BUILDER || file.includes(".test.") || file.includes("test-support") || file.endsWith(".d.ts")) continue
    const sites = authorizationSites(file, await Bun.file(join(REPO, file)).text())
    if (sites.length > 0) offenders.push(`${file}: ${sites.join(", ")}`)
  }

  expect(offenders.sort()).toEqual([])
})
