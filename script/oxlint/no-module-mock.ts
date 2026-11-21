// Module-mock half of no-test-doubles from interfere-inc/landmines 0.1.0 (MIT, Copyright (c) 2026
// Interfere, Inc.), packages/landmines/src/rules/no-test-doubles.ts: vi.mock, vi.doMock and jest.mock
// keep upstream's detection, including its `{ spy: true }` observation exception. Upstream does not
// know bun:test, so bun's mock.module and its vi.mock alias are added here. Per-file counts are pinned
// in the lint ratchet.
type Node = {
  readonly type: string
  readonly [key: string]: unknown
}

type RuleContext = {
  readonly report: (problem: { readonly node: Node; readonly messageId: string }) => void
}

// Each mocking object (a module's export, also a global when the runner injects it) and the methods on
// it that replace a whole module. bun:test's `vi.mock` is an alias of `mock.module`.
const mockers = [
  { module: "bun:test", name: "mock", global: false, methods: ["module"] },
  { module: "bun:test", name: "vi", global: false, methods: ["mock"] },
  { module: "vitest", name: "vi", global: true, methods: ["mock", "doMock"] },
  { module: "vitest", name: "vitest", global: true, methods: ["mock", "doMock"] },
  { module: "@jest/globals", name: "jest", global: true, methods: ["mock", "doMock", "unstable_mockModule"] },
] as const

type Mocker = (typeof mockers)[number]

const mockerOf = (module: string | null, name: string | null): Mocker | undefined =>
  mockers.find((mocker) => mocker.module === module && mocker.name === name)

const testModules: ReadonlySet<string> = new Set(mockers.map((mocker) => mocker.module))

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string"

const child = (node: Node, key: string): Node | undefined => {
  const value = node[key]
  return isNode(value) ? value : undefined
}

const nodes = (node: Node, key: string): readonly Node[] => {
  const values = Array.isArray(node[key]) ? (node[key] as unknown[]) : []
  return values.filter(isNode)
}

const unwrap = (initial: Node): Node => {
  let node = initial
  while (
    node.type === "TSAsExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "TSNonNullExpression" ||
    node.type === "TSTypeAssertion" ||
    node.type === "ParenthesizedExpression" ||
    node.type === "AwaitExpression"
  ) {
    node = child(node, node.type === "AwaitExpression" ? "argument" : "expression") as Node
  }
  return node
}

const nameOf = (node: Node | undefined): string | null => {
  if (node?.type === "Identifier") return String(node["name"])
  return node?.type === "Literal" && typeof node["value"] === "string" ? node["value"] : null
}

const propertyName = (member: Node): string | null => {
  const property = child(member, "property")
  if (member["computed"] !== true) return property?.type === "Identifier" ? String(property["name"]) : null
  return property?.type === "Literal" ? nameOf(property) : null
}

const identifier = (node: Node | undefined): string | null => {
  const target = node === undefined ? undefined : unwrap(node)
  return target?.type === "Identifier" ? String(target["name"]) : null
}

// A require function: `require` itself, or one made inline by `createRequire(import.meta.url)`.
const isRequire = (initial: Node | undefined): boolean => {
  const node = initial === undefined ? undefined : unwrap(initial)
  if (node === undefined) return false
  if (identifier(node) === "require") return true
  return node.type === "CallExpression" && identifier(child(node, "callee")) === "createRequire"
}

// `require(x)`, `createRequire(...)(x)` and `import(x)` load the same module as a static import.
const loadedModule = (initial: Node): string | null => {
  const node = unwrap(initial)
  if (node.type === "ImportExpression") return nameOf(child(node, "source"))
  if (node.type !== "CallExpression" || !isRequire(child(node, "callee"))) return null
  return nameOf(nodes(node, "arguments")[0])
}

// upstream: `vi.mock(path, { spy: true })` keeps the real module and only observes it.
const observes = (call: Node): boolean => {
  const args = nodes(call, "arguments")
  const options = args[1]
  if (args.length !== 2 || options?.type !== "ObjectExpression") return false
  const properties = nodes(options, "properties")
  const [only] = properties
  return (
    properties.length === 1 &&
    only?.type === "Property" &&
    only["computed"] !== true &&
    nameOf(child(only, "key")) === "spy" &&
    child(only, "value")?.type === "Literal" &&
    child(only, "value")?.["value"] === true
  )
}

const noModuleMock = {
  meta: {
    type: "problem" as const,
    docs: {
      description: "Disallow replacing a whole module in a test (bun mock.module, vi.mock, jest.mock).",
    },
    messages: {
      module:
        "Do not replace a module in a test: the replacement leaks to every importer in the test process and hides the real wiring. Inject the dependency instead (a parameter, option, or factory argument the test passes a fake to), or use a real fake at a boundary (a temp directory, a local server, an in-memory implementation of the interface).",
    },
  },
  create: (context: RuleContext) => {
    const objects = new Map<string, Mocker>()
    const namespaces = new Map<string, string>()
    const imported = new Set<string>()
    const declarators: Node[] = []
    const calls: Node[] = []

    const loadedTestModule = (node: Node): string | null => {
      const module = loadedModule(node)
      return module !== null && testModules.has(module) ? module : null
    }

    const objectOf = (initial: Node): Mocker | undefined => {
      const node = unwrap(initial)
      if (node.type === "Identifier") {
        const name = String(node["name"])
        if (objects.has(name) || imported.has(name)) return objects.get(name)
        return mockers.find((mocker) => mocker.global && mocker.name === name)
      }
      if (node.type !== "MemberExpression") return undefined
      const object = child(node, "object") as Node
      return mockerOf(namespaces.get(identifier(object) ?? "") ?? loadedTestModule(object), propertyName(node))
    }

    const namespaceOf = (node: Node): string | null =>
      loadedTestModule(node) ?? namespaces.get(identifier(node) ?? "") ?? null

    const bindExports = (pattern: Node, module: string): void => {
      for (const property of nodes(pattern, "properties")) {
        const mocker = property.type === "Property" ? mockerOf(module, nameOf(child(property, "key"))) : undefined
        if (mocker === undefined) continue
        const value = child(property, "value")
        const local = value?.type === "AssignmentPattern" ? child(value, "left") : value
        if (local?.type === "Identifier") objects.set(String(local["name"]), mocker)
      }
    }

    // Returns whether the declarator bound a new name, so aliases of aliases resolve too.
    const bind = (declarator: Node): boolean => {
      const id = child(declarator, "id")
      const init = child(declarator, "init")
      if (id === undefined || init === undefined) return false
      const before = objects.size + namespaces.size
      if (id.type === "Identifier") {
        const name = String(id["name"])
        const object = objectOf(init)
        const module = loadedTestModule(init)
        if (object !== undefined) objects.set(name, object)
        else if (module !== null) namespaces.set(name, module)
      } else if (id.type === "ObjectPattern") {
        const module = namespaceOf(init)
        if (module !== null) bindExports(id, module)
      }
      return objects.size + namespaces.size > before
    }

    return {
      ImportDeclaration: (node: Node) => {
        const source = nameOf(child(node, "source"))
        const module = node["importKind"] !== "type" && source !== null && testModules.has(source) ? source : null
        for (const specifier of nodes(node, "specifiers")) {
          const local = nameOf(child(specifier, "local"))
          if (local === null) continue
          imported.add(local)
          if (module === null) continue
          if (specifier.type === "ImportNamespaceSpecifier") namespaces.set(local, module)
          const mocker =
            specifier.type === "ImportSpecifier" && specifier["importKind"] !== "type"
              ? mockerOf(module, nameOf(child(specifier, "imported")))
              : undefined
          if (mocker !== undefined) objects.set(local, mocker)
        }
      },
      VariableDeclarator: (node: Node) => {
        declarators.push(node)
      },
      CallExpression: (node: Node) => {
        if (unwrap(child(node, "callee") as Node).type === "MemberExpression") calls.push(node)
      },
      // Resolved after the whole file is read, so a call above its import or require still counts.
      "Program:exit": () => {
        let bound = true
        while (bound) bound = declarators.map(bind).includes(true)
        for (const call of calls) {
          const callee = unwrap(child(call, "callee") as Node)
          const mocker = objectOf(child(callee, "object") as Node)
          const method = propertyName(callee) ?? ""
          if (mocker === undefined || !(mocker.methods as readonly string[]).includes(method)) continue
          if (mocker.module === "vitest" && observes(call)) continue
          context.report({ node: call, messageId: "module" })
        }
      },
    }
  },
}

export default noModuleMock
