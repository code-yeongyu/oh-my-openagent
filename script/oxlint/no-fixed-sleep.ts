// Ported from interfere-inc/landmines 0.1.0 (MIT, Copyright (c) 2026 Interfere, Inc.),
// packages/landmines/src/rules/no-fixed-sleep.ts. Detection is unchanged; the upstream per-file
// allowlist option is dropped because this repo pins per-file counts in the lint ratchet.
type Node = {
  readonly type: string
  readonly parent?: Node
  readonly [key: string]: unknown
}

type RuleContext = {
  readonly report: (problem: { readonly node: Node; readonly messageId: string }) => void
}

const testCallees = new Set(["test", "it", "beforeEach", "afterEach", "beforeAll", "afterAll"])
const timerModules = new Set(["node:timers/promises", "timers/promises"])

const isMember = (node: Node, object: string, property: string): boolean =>
  node.type === "MemberExpression" &&
  child(node, "object")?.type === "Identifier" &&
  child(node, "object")?.["name"] === object &&
  child(node, "property")?.type === "Identifier" &&
  node["computed"] !== true &&
  child(node, "property")?.["name"] === property

const isSetTimeout = (node: Node): boolean =>
  (node.type === "Identifier" && node["name"] === "setTimeout") ||
  isMember(node, "globalThis", "setTimeout") ||
  isMember(node, "window", "setTimeout")

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string"

const child = (node: Node, key: string): Node | undefined => {
  const value = node[key]
  return isNode(value) ? value : undefined
}

const calleeRoot = (node: Node): string | undefined => {
  if (node.type === "CallExpression") return calleeRoot(child(node, "callee") as Node)
  if (node.type === "MemberExpression") return calleeRoot(child(node, "object") as Node)
  if (node.type === "TaggedTemplateExpression") return calleeRoot(child(node, "tag") as Node)
  return node.type === "Identifier" ? (node["name"] as string) : undefined
}

const inTestBody = (node: Node): boolean => {
  let current = child(node, "parent")

  while (
    current !== undefined &&
    current.type !== "ArrowFunctionExpression" &&
    current.type !== "FunctionExpression" &&
    current.type !== "FunctionDeclaration"
  ) {
    current = child(current, "parent")
  }

  const call = current === undefined ? undefined : child(current, "parent")

  return call?.type === "CallExpression" && testCallees.has(calleeRoot(child(call, "callee") as Node) ?? "")
}

const scheduled = (body: Node | undefined): Node | null => {
  if (body?.type !== "BlockStatement") return body ?? null

  const statements = Array.isArray(body["body"]) ? (body["body"] as unknown[]) : []
  const [statement, ...rest] = statements

  return isNode(statement) && statement.type === "ExpressionStatement" && rest.length === 0
    ? (child(statement, "expression") ?? null)
    : null
}

const resolvesAfterTimeout = (node: Node): boolean => {
  const [executor] = Array.isArray(node["arguments"]) ? (node["arguments"] as unknown[]) : []

  if (!isNode(executor) || (executor.type !== "ArrowFunctionExpression" && executor.type !== "FunctionExpression")) {
    return false
  }

  const [resolve] = Array.isArray(executor["params"]) ? (executor["params"] as unknown[]) : []

  if (!isNode(resolve) || resolve.type !== "Identifier") return false

  const call = scheduled(child(executor, "body"))

  if (call?.type !== "CallExpression" || !isSetTimeout(child(call, "callee") as Node)) return false

  const [handler] = Array.isArray(call["arguments"]) ? (call["arguments"] as unknown[]) : []

  if (isNode(handler) && handler.type === "Identifier") {
    return handler["name"] === resolve["name"]
  }

  return (
    isNode(handler) &&
    handler.type === "ArrowFunctionExpression" &&
    child(handler, "body")?.type === "CallExpression" &&
    child(child(handler, "body") as Node, "callee")?.type === "Identifier" &&
    child(child(handler, "body") as Node, "callee")?.["name"] === resolve["name"]
  )
}

const noFixedSleep = {
  meta: {
    type: "problem" as const,
    docs: {
      description: "Disallow awaiting a fixed real-time sleep in a test or hook body (landmines no-fixed-sleep).",
    },
    messages: {
      sleep:
        "Replace this fixed sleep with a signal: await the operation itself or a promise its handler resolves. To move time, use fake timers and advance them. A sleep guesses how long real work takes and fails under CPU load.",
    },
  },
  create: (context: RuleContext) => {
    const timers = new Set<string>()
    let fakeTimers = false

    const isSleep = (node: Node): boolean => {
      if (node.type === "NewExpression") {
        return (
          child(node, "callee")?.type === "Identifier" &&
          child(node, "callee")?.["name"] === "Promise" &&
          resolvesAfterTimeout(node)
        )
      }

      if (node.type !== "CallExpression") return false

      const callee = child(node, "callee") as Node
      return (
        (callee.type === "Identifier" && timers.has(callee["name"] as string)) ||
        isMember(callee, "scheduler", "wait") ||
        isMember(callee, "Bun", "sleep")
      )
    }

    return {
      ImportDeclaration: (node: Node) => {
        const source = child(node, "source")
        if (source === undefined || !timerModules.has(String(source["value"]))) return

        const specifiers = Array.isArray(node["specifiers"]) ? (node["specifiers"] as unknown[]) : []
        for (const specifier of specifiers) {
          if (
            isNode(specifier) &&
            specifier.type === "ImportSpecifier" &&
            child(specifier, "imported")?.type === "Identifier" &&
            child(specifier, "imported")?.["name"] === "setTimeout"
          ) {
            timers.add(String(child(specifier, "local")?.["name"]))
          }
        }
      },
      CallExpression: (node: Node) => {
        if (isMember(child(node, "callee") as Node, "vi", "useFakeTimers")) fakeTimers = true
      },
      AwaitExpression: (node: Node) => {
        if (!fakeTimers && isSleep(child(node, "argument") as Node) && inTestBody(node)) {
          context.report({ node, messageId: "sleep" })
        }
      },
    }
  },
}

export default noFixedSleep
