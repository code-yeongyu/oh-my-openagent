import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "@typescript/typescript6"
import { FakeExtensionAPI } from "../test-support/fake-extension-api"
import { composeOmoSenpiExtension, omoSenpiComponents } from "./extension/index"

const root = fileURLToPath(new URL(".", import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)
      && !entry.name.includes(".test.") && !entry.name.includes(".test-support.") ? [path] : []
  })
}

test("#given every production before_agent_start registration #when parsed #then each explicitly opts into preview safety", () => {
  // given
  const unsafe: string[] = []
  let registrations = 0
  // when
  for (const path of sources(root)) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "on" && node.arguments[0]
        && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text === "before_agent_start") {
        registrations += 1
        const options = node.arguments[2]
        const safe = options && ts.isObjectLiteralExpression(options) && options.properties.some((property) =>
          ts.isPropertyAssignment(property)
          && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
          && property.name.text === "previewSafe" && property.initializer.kind === ts.SyntaxKind.TrueKeyword)
        if (!safe) unsafe.push(`${relative(root, path)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  // then
  expect(registrations).toBeGreaterThan(0)
  expect(unsafe).toEqual([])
})


test("#given the composed OmO extension #when every registration is recorded #then dynamic before-agent-start handlers are preview-safe with source locations", async () => {
  // given
  const dir = mkdtempSync(join(tmpdir(), "omo-preview-audit-"))
  const agentDir = join(dir, "agent")
  mkdirSync(agentDir)
  const cwd = process.cwd()
  const overrides = { HOME: dir, OMO_CODING_AGENT_DIR: agentDir, SENPI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_DIR: agentDir, OMO_SENPI_DISABLE_POSTHOG: "1" }
  const previous = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]))
  const pi = new FakeExtensionAPI()
  pi.cwd = dir
  const registrations: { readonly source: string | undefined; readonly safe: boolean }[] = []
  const on = pi.on.bind(pi)
  pi.on = (event, handler, options) => {
    if (event === "before_agent_start") {
      const source = new Error().stack?.replaceAll("\\", "/").split("\n")
        .find((line) => line.includes("/src/") && !line.includes("before-agent-start-preview.audit.test"))
      registrations.push({ source, safe: options?.previewSafe === true })
    }
    on(event, handler, options)
  }
  const errors: unknown[] = []
  Object.assign(process.env, overrides)
  process.chdir(dir)
  try {
    // when
    await composeOmoSenpiExtension(omoSenpiComponents, {
      logger: { info() {}, warn() {}, error: (message, details) => { errors.push({ message, details }) } },
    })(pi)
    // then
    expect(errors).toEqual([])
    expect(registrations.length).toBeGreaterThan(0)
    expect(registrations.filter(({ source }) => source === undefined)).toEqual([])
    expect(registrations.filter(({ safe }) => !safe)).toEqual([])
  } finally {
    await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" })
    process.chdir(cwd)
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(dir, { recursive: true, force: true })
  }
})
