import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "node:fs"
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import * as ts from "typescript/unstable/ast"
import { TypeScriptSourceParser } from "./typescript-native-source-parser"

function __repoRootFrom(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(path.join(dir, "bun.lock")) || existsSync(path.join(dir, ".git"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error("repo root sentinel not found")
    dir = parent
  }
}

const SOURCE_ROOT = path.resolve(import.meta.dir, "..")
const WORKSPACE_ROOT = __repoRootFrom(import.meta.dir)
const parser = new TypeScriptSourceParser(WORKSPACE_ROOT)
const snippetDirectory = mkdtempSync(path.join(tmpdir(), "prompt-async-route-audit-"))
let snippetIndex = 0
afterAll(async () => {
  await parser.close()
  await rm(snippetDirectory, { recursive: true, force: true })
})
const PROMPT_GATE_FILE = path.join(SOURCE_ROOT, "shared", "prompt-async-gate.ts")
const PROMPT_GATE_FILES = new Set([
  PROMPT_GATE_FILE,
  path.join(WORKSPACE_ROOT, "packages", "utils", "src", "prompt-async-gate.ts"),
])
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
    path.join(SOURCE_ROOT, "plugin", "unstable-agent-babysitter.ts"),
    "binds SDK Session.promptAsync into a narrow facade consumed only by gate-routed unstable-agent-babysitter dispatch; performs no direct dispatch itself",
  ],
  [
    path.join(WORKSPACE_ROOT, "packages", "senpi-task", "src", "runners", "in-process", "child-handle.ts"),
    "drives a senpi CHILD AgentSession.prompt for spawned subagent turns; senpi-task cannot reach OpenCode session APIs (opencode-coupling audit) so the main-session injection invariant does not apply",
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

async function listPackageSourceFiles(): Promise<string[]> {
  const packagesDir = path.join(WORKSPACE_ROOT, "packages")
  let packageNames: string[] = []
  try {
    packageNames = await readdir(packagesDir)
  } catch {
    return []
  }

  const nestedFiles = await Promise.all(packageNames.map(async (name) => {
    if (name === "omo-opencode") {
      return []
    }
    const packageSrc = path.join(packagesDir, name, "src")
    try {
      const s = await stat(packageSrc)
      if (!s.isDirectory()) {
        return []
      }
    } catch {
      return []
    }
    return listSourceFiles(packageSrc)
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

  if (ts.isPropertyAccessExpression(unwrapped)) {
    const propertyName = getPropertyName(unwrapped.name)
    return propertyName === "session"
  }

  if (ts.isElementAccessExpression(unwrapped)) {
    const argument = unwrapped.argumentExpression
    if (!argument) {
      return false
    }

    return getPropertyName(argument) === "session"
  }

  return false
}

function isRawPromptPropertyAccess(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    const propertyName = getPropertyName(node.name)
    if (propertyName !== "prompt" && propertyName !== "promptAsync") {
      return false
    }

    return isSessionAccessExpression(node.expression)
  }

  if (ts.isElementAccessExpression(node)) {
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
      : ts.isIdentifier(element.name) ? getPropertyName(element.name) : null
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

async function parseSnippet(contents: string): Promise<ts.SourceFile> {
  const filePath = path.join(snippetDirectory, `snippet-${snippetIndex++}.ts`)
  await writeFile(filePath, contents)
  const sourceFile = (await parser.parse([filePath])).get(filePath)
  if (!sourceFile) {
    throw new Error(`TypeScript did not parse ${filePath}`)
  }
  return sourceFile
}

function detectRawPromptInSourceFile(sourceFile: ts.SourceFile): boolean {
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

    node.forEachChild(visit)
  }

  visit(sourceFile)
  return detected
}

async function detectRawPromptInSnippet(contents: string): Promise<boolean> {
  return detectRawPromptInSourceFile(await parseSnippet(contents))
}

function objectLiteralHasQueueBehavior(node: ts.ObjectLiteralExpression, sourceFile: ts.SourceFile): boolean {
  return node.properties.some((property) => {
    if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
      return getPropertyName(property.name) === "queueBehavior"
    }
    if (ts.isSpreadAssignment(property)) {
      return property.expression.getText(sourceFile).includes("queueBehavior")
    }
    return false
  })
}

function callExpressionName(node: ts.Expression): string | null {
  const callee = unwrapExpression(node)
  if (ts.isIdentifier(callee)) {
    return callee.text
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return getPropertyName(callee.name)
  }
  return null
}

function findPromptGateCallsWithoutQueueBehaviorInSourceFile(sourceFile: ts.SourceFile): number[] {
  const offenders: number[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (callExpressionName(node.expression) === "dispatchInternalPrompt") {
        const firstArgument = node.arguments[0]
        if (
          !firstArgument
          || !ts.isObjectLiteralExpression(firstArgument)
          || !objectLiteralHasQueueBehavior(firstArgument, sourceFile)
        ) {
          offenders.push(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1)
        }
      }
    }

    node.forEachChild(visit)
  }

  visit(sourceFile)
  return offenders
}

async function findPromptGateCallsWithoutQueueBehavior(_filePath: string, contents: string): Promise<number[]> {
  return findPromptGateCallsWithoutQueueBehaviorInSourceFile(await parseSnippet(contents))
}

function findPromptRetryCallsWithoutQueueBehaviorInSourceFile(sourceFile: ts.SourceFile): number[] {
  const offenders: number[] = []
  const guardedNames = new Set(["promptWithModelSuggestionRetry", "promptSyncWithModelSuggestionRetry"])

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && guardedNames.has(callExpressionName(node.expression) ?? "")) {
      const optionsArgument = node.arguments[2]
      if (!optionsArgument || !ts.isObjectLiteralExpression(optionsArgument) || !objectLiteralHasQueueBehavior(optionsArgument, sourceFile)) {
        offenders.push(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1)
      }
    }

    node.forEachChild(visit)
  }

  visit(sourceFile)
  return offenders
}

describe("production prompt injection routes", () => {
  test("#given a destructuring promptAsync reference #when audit scans snippet #then it is flagged", async () => {
    // given
    const snippet = "const { promptAsync } = client.session"

    // when
    const detected = await detectRawPromptInSnippet(snippet)

    // then
    expect(detected).toBe(true)
  })

  test("#given bracket promptAsync reference #when audit scans snippet #then it is flagged", async () => {
    // given
    const snippet = "const value = client['session']['promptAsync']"

    // when
    const detected = await detectRawPromptInSnippet(snippet)

    // then
    expect(detected).toBe(true)
  })

  test("#given type-cast promptAsync reference #when audit scans snippet #then it is flagged", async () => {
    // given
    const snippet = "const promptAsync = (client.session as { promptAsync?: unknown }).promptAsync"

    // when
    const detected = await detectRawPromptInSnippet(snippet)

    // then
    expect(detected).toBe(true)
  })

  test("#given optional-chain promptAsync call #when audit scans snippet #then it is flagged", async () => {
    // given
    const snippet = "await client.session?.promptAsync({ body: { text: 'hi' } })"

    // when
    const detected = await detectRawPromptInSnippet(snippet)

    // then
    expect(detected).toBe(true)
  })

  test("#given indirect dispatchInternalPrompt options #when audit scans snippet #then it is flagged", async () => {
    // given
    const snippet = `
const options = { mode: "async", queueBehavior: "defer" }
await dispatchInternalPrompt(options)
`

    // when
    const offenders = await findPromptGateCallsWithoutQueueBehavior("audit-snippet.ts", snippet)

    // then
    expect(offenders).toEqual([3])
  })

  test("#given production TypeScript sources #when prompt routes are audited #then only the shared gate may call raw OpenCode prompt APIs", async () => {
    // given
    const files = [...await listSourceFiles(SOURCE_ROOT), ...await listPackageSourceFiles()]
    const candidates = await Promise.all(files.map(async (filePath) => {
      if (PROMPT_GATE_FILES.has(filePath) || RAW_PROMPT_ALLOWLIST.has(filePath)) {
        return null
      }
      const contents = await readFile(filePath, "utf8")
      return contents.includes("prompt") ? filePath : null
    }))
    const parsedSourceFiles = await parser.parse(candidates.filter((filePath): filePath is string => filePath !== null))
    const offenders: string[] = []

    // when
    for (const filePath of candidates) {
      if (!filePath) {
        continue
      }
      const sourceFile = parsedSourceFiles.get(filePath)
      if (!sourceFile) {
        throw new Error(`TypeScript did not parse ${filePath}`)
      }
      if (detectRawPromptInSourceFile(sourceFile)) {
        offenders.push(relativeSourcePath(filePath))
      }
    }

    // then
    expect(offenders).toEqual([])
  })

  test("#given production TypeScript sources #when prompt gate callers are audited #then callers cannot disable the post-dispatch reservation hold", async () => {
    // given
    const files = [...await listSourceFiles(SOURCE_ROOT), ...await listPackageSourceFiles()]
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

  test("#given production TypeScript sources #when prompt gate callers are audited #then callers cannot bypass the central prompt queue", async () => {
    // given
    const files = [...await listSourceFiles(SOURCE_ROOT), ...await listPackageSourceFiles()]
    const offenders: string[] = []

    // when
    for (const filePath of files) {
      const contents = await readFile(filePath, "utf8")
      if (/queue\s*:\s*false\b/.test(contents)) {
        offenders.push(relativeSourcePath(filePath))
      }
    }

    // then
    expect(offenders).toEqual([])
  })

  test("#given production TypeScript sources #when prompt gate callers are audited #then every route declares queue behavior explicitly", async () => {
    // given
    const files = [...await listSourceFiles(SOURCE_ROOT), ...await listPackageSourceFiles()]
    const candidates = await Promise.all(files.map(async (filePath) => {
      const contents = await readFile(filePath, "utf8")
      return contents.includes("dispatchInternalPrompt") ? filePath : null
    }))
    const parsedSourceFiles = await parser.parse(candidates.filter((filePath): filePath is string => filePath !== null))
    const offenders: string[] = []

    // when
    for (const filePath of candidates) {
      if (!filePath) {
        continue
      }
      const sourceFile = parsedSourceFiles.get(filePath)
      if (!sourceFile) {
        throw new Error(`TypeScript did not parse ${filePath}`)
      }
      const missingLines = findPromptGateCallsWithoutQueueBehaviorInSourceFile(sourceFile)
      for (const line of missingLines) {
        offenders.push(`${relativeSourcePath(filePath)}:${line}`)
      }
    }

    // then
    expect(offenders).toEqual([])
  })

  test("#given production TypeScript sources #when model-suggestion prompt wrappers are audited #then every retry caller declares queue behavior explicitly", async () => {
    // given
    const files = [...await listSourceFiles(SOURCE_ROOT), ...await listPackageSourceFiles()]
    const candidates = await Promise.all(files.map(async (filePath) => {
      const contents = await readFile(filePath, "utf8")
      return contents.includes("promptWithModelSuggestionRetry") || contents.includes("promptSyncWithModelSuggestionRetry")
        ? filePath
        : null
    }))
    const parsedSourceFiles = await parser.parse(candidates.filter((filePath): filePath is string => filePath !== null))
    const offenders: string[] = []

    // when
    for (const filePath of candidates) {
      if (!filePath) {
        continue
      }
      const sourceFile = parsedSourceFiles.get(filePath)
      if (!sourceFile) {
        throw new Error(`TypeScript did not parse ${filePath}`)
      }
      const missingLines = findPromptRetryCallsWithoutQueueBehaviorInSourceFile(sourceFile)
      for (const line of missingLines) {
        offenders.push(`${relativeSourcePath(filePath)}:${line}`)
      }
    }

    // then
    expect(offenders).toEqual([])
  })
})
