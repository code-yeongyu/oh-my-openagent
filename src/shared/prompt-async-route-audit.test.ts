import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import ts from "typescript"

const SOURCE_ROOT = path.resolve(import.meta.dir, "..")
const PROMPT_GATE_FILE = path.join(SOURCE_ROOT, "shared", "prompt-async-gate.ts")
const RAW_PROMPT_ALLOWLIST = new Map<string, string>([
  [
    path.join(SOURCE_ROOT, "plugin", "event.ts"),
    "team idle wake hint wires a client facade for downstream gate-routed dispatch",
  ],
  [
    path.join(SOURCE_ROOT, "plugin", "build-team-idle-wake-hint-client.ts"),
    "binds SDK Session.promptAsync/.status into a narrow facade consumed only by gate-routed team-idle-wake-hint dispatch; performs no direct dispatch itself",
  ],
  [
    path.join(SOURCE_ROOT, "hooks", "session-recovery", "recover-unavailable-tool.ts"),
    "runtime type guard checks promptAsync presence before gate-routed promptAsyncAfterSessionIdle",
  ],
])

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return listSourceFiles(entryPath)
    }
    if (
      entry.isFile()
      && entry.name.endsWith(".ts")
      && !entry.name.endsWith(".test.ts")
      && !entry.name.endsWith(".d.ts")
    ) {
      return [entryPath]
    }
    return []
  }))

  return nestedFiles.flat()
}

function relativeSourcePath(filePath: string): string {
  return path.relative(SOURCE_ROOT, filePath)
}

function getPropertyName(node: ts.PropertyName | ts.MemberName | ts.Expression): string | null {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
    return node.text
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }

  return null
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression)) {
    return unwrapExpression(expression.expression)
  }

  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return unwrapExpression(expression.expression)
  }

  if (ts.isNonNullExpression(expression)) {
    return unwrapExpression(expression.expression)
  }

  return expression
}

function isSessionAccessExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression)

  if (ts.isIdentifier(unwrapped)) {
    return unwrapped.text === "session"
  }

  if (
    ts.isPropertyAccessExpression(unwrapped)
    || ts.isPropertyAccessChain(unwrapped)
  ) {
    const propertyName = getPropertyName(unwrapped.name)
    return propertyName === "session"
  }

  if (
    ts.isElementAccessExpression(unwrapped)
    || ts.isElementAccessChain(unwrapped)
  ) {
    const argument = unwrapped.argumentExpression
    if (!argument) {
      return false
    }

    return getPropertyName(argument) === "session"
  }

  return false
}

function isRawPromptPropertyAccess(node: ts.Node): boolean {
  if (
    ts.isPropertyAccessExpression(node)
    || ts.isPropertyAccessChain(node)
  ) {
    const propertyName = getPropertyName(node.name)
    if (propertyName !== "prompt" && propertyName !== "promptAsync") {
      return false
    }

    return isSessionAccessExpression(node.expression)
  }

  if (
    ts.isElementAccessExpression(node)
    || ts.isElementAccessChain(node)
  ) {
    const argument = node.argumentExpression
    if (!argument) {
      return false
    }

    const propertyName = getPropertyName(argument)
    if (propertyName !== "prompt" && propertyName !== "promptAsync") {
      return false
    }

    return isSessionAccessExpression(node.expression)
  }

  return false
}

function isPromptBindingPattern(node: ts.Node): boolean {
  if (!ts.isVariableDeclaration(node) || !node.initializer || !ts.isObjectBindingPattern(node.name)) {
    return false
  }

  if (!isSessionAccessExpression(node.initializer)) {
    return false
  }

  return node.name.elements.some((element) => {
    const keyName = element.propertyName
      ? getPropertyName(element.propertyName)
      : getPropertyName(element.name)
    return keyName === "prompt" || keyName === "promptAsync"
  })
}

function isReflectApplyPromptCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) {
    return false
  }

  const callee = unwrapExpression(node.expression)
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "apply") {
    return false
  }

  if (!ts.isIdentifier(callee.expression) || callee.expression.text !== "Reflect") {
    return false
  }

  const firstArgument = node.arguments[0]
  if (!firstArgument) {
    return false
  }

  return isRawPromptPropertyAccess(firstArgument)
}

function isTypeofPromptCheck(node: ts.Node): boolean {
  return ts.isTypeOfExpression(node.parent)
}

function detectRawPromptInSnippet(contents: string): boolean {
  const sourceFile = ts.createSourceFile("audit-snippet.ts", contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let detected = false

  const visit = (node: ts.Node): void => {
    if (detected) {
      return
    }

    const isRawPromptAccess = isRawPromptPropertyAccess(node) && !isTypeofPromptCheck(node)
    if (isRawPromptAccess || isPromptBindingPattern(node) || isReflectApplyPromptCall(node)) {
      detected = true
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return detected
}

describe("production prompt injection routes", () => {
  test("#given a destructuring promptAsync reference #when audit scans snippet #then it is flagged", () => {
    // given
    const snippet = "const { promptAsync } = client.session"

    // when
    const detected = detectRawPromptInSnippet(snippet)

    // then
    expect(detected).toBe(true)
  })

  test("#given bracket promptAsync reference #when audit scans snippet #then it is flagged", () => {
    // given
    const snippet = "const value = client['session']['promptAsync']"

    // when
    const detected = detectRawPromptInSnippet(snippet)

    // then
    expect(detected).toBe(true)
  })

  test("#given type-cast promptAsync reference #when audit scans snippet #then it is flagged", () => {
    // given
    const snippet = "const promptAsync = (client.session as { promptAsync?: unknown }).promptAsync"

    // when
    const detected = detectRawPromptInSnippet(snippet)

    // then
    expect(detected).toBe(true)
  })

  test("#given optional-chain promptAsync call #when audit scans snippet #then it is flagged", () => {
    // given
    const snippet = "await client.session?.promptAsync({ body: { text: 'hi' } })"

    // when
    const detected = detectRawPromptInSnippet(snippet)

    // then
    expect(detected).toBe(true)
  })

  test("#given production TypeScript sources #when prompt routes are audited #then only the shared gate may call raw OpenCode prompt APIs", async () => {
    // given
    const files = await listSourceFiles(SOURCE_ROOT)
    const offenders: string[] = []

    // when
    for (const filePath of files) {
      if (filePath === PROMPT_GATE_FILE || RAW_PROMPT_ALLOWLIST.has(filePath)) {
        continue
      }

      const contents = await readFile(filePath, "utf8")
      if (detectRawPromptInSnippet(contents)) {
        offenders.push(relativeSourcePath(filePath))
      }
    }

    // then
    expect(offenders).toEqual([])
  })

  test("#given production TypeScript sources #when prompt gate callers are audited #then callers cannot disable the post-dispatch reservation hold", async () => {
    // given
    const files = await listSourceFiles(SOURCE_ROOT)
    const offenders: string[] = []

    // when
    for (const filePath of files) {
      const contents = await readFile(filePath, "utf8")
      if (/postDispatchHoldMs\s*:\s*0\b/.test(contents)) {
        offenders.push(relativeSourcePath(filePath))
      }
    }

    // then
    expect(offenders).toEqual([])
  })
})
